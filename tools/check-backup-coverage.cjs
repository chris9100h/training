#!/usr/bin/env node
// Backup coverage drift check (CI, offline). Guards that the data export/import
// in src/store.js stay in sync with the DB schema, so a user backup round-trips
// EVERY column. This is the automation for the failure mode where someone adds a
// column/table and forgets to teach export or import about it (e.g. a settings
// column that silently vanishes on restore).
//
// Source of truth: supabase/schema.sql (already reconciled with the migrations by
// check-db-docs.cjs and with the live DB by check-db-live.cjs). Parsed with the
// shared helper in tools/lib/sql-schema.cjs: one parser, no second truth.
//
// Three checks:
//   IMPORT  : actually runs importFromBackup() in a vm sandbox with a recording
//             Supabase stub and captures which columns each upsert writes. Robust
//             against columns built inside helpers (sessionToRow, _syncEntryRelational).
//   EXPORT  : parses the .select('…') lists in store.js: a column that is never
//             SELECTed never reaches the store, so it is absent from the export.
//   SYNC    : zane_user_settings only. IMPORT/EXPORT only prove a setting round-trips
//             through a backup file, not that it actually propagates live between a
//             user's devices. Parses settingsChanged's diff and syncStore's live
//             upsert in src/store.js and flags a setting loadFromSupabase maps into
//             the store that either spot never mentions.
//
// On drift it prints exactly what is missing AND a ready-to-paste prompt for
// Claude to fix it, then exits non-zero.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSchemaTables } = require('./lib/sql-schema.cjs');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ── Classification ──────────────────────────────────────────────────────────
// Every zane_ table must be listed somewhere below, or the check fails: adding a
// table forces a deliberate "belongs in the backup?" decision.

// Tables restored by importFromBackup with an explicit, column-by-column upsert.
const BACKUP_ENUM = [
  'zane_profiles', 'zane_exercises', 'zane_session_entries', 'zane_sets',
  'zane_user_settings', 'zane_skips', 'zane_cardio_logs', 'zane_daily_logs',
  'zane_workout_templates', 'zane_glucose_logs', 'zane_cardio_plans',
  'zane_status_periods', 'zane_meso_states', 'zane_checkin_schema_templates',
  'zane_blood_pressure_logs', 'zane_body_temp_logs', 'zane_water_logs',
  'zane_adaptive_tdee_history',
  'zane_food_logs', 'zane_food_favorites', 'zane_food_recipes',
  'zane_food_template_slots', 'zane_food_meal_plans', 'zane_food_shopping_prefs',
  'zane_medication_plans', 'zane_medications', 'zane_medication_plan_items',
  'zane_medication_schedule_slots', 'zane_medication_logs',
];
// Tables restored by spreading the whole store row (…s). Their column coverage is
// governed by what loadFromSupabase SELECTs, so they are export-checked only.
const PASSTHROUGH = ['zane_schedules', 'zane_sessions'];
// Deliberately NOT part of a personal data backup.
const EXCLUDED = {
  zane_app_config: 'admin/global config',
  zane_api_usage: 'server-side daily call counter for the food edge functions, never read by the app and meaningless once restored',
  zane_feature_map: 'admin feature-map draft/override layer (master content is in code), not per-user data',
  zane_feature_map_published: 'published feature-map layer (mirror of the admin draft), not per-user data',
  zane_feature_grants: 'admin-managed grants',
  zane_push_subscriptions: 'device-scoped push state',
  zane_pushover_active: 'integration/device state',
  zane_schedule_backups: 'auto plan-day snapshots, regenerated on edit',
  zane_plan_drafts: 'transient in-progress plan-editor draft, deleted on save/discard (not backup data)',
  zane_coaching: 'coaching relationships reference other users (export archive only)',
  zane_coaching_threads: 'coaching (export archive only)',
  zane_coaching_notes: 'coaching (export archive only)',
  zane_coaching_macros: 'coaching (export archive only)',
  zane_checkins: 'coaching (export archive only)',
  zane_social_profiles: 'friends identity/privacy state is shared social account data and can be regenerated from server state; it is not personal workout backup data',
  zane_social_friendships: 'friends relationships reference other users, not personal workout backup data',
  zane_social_blocks: 'friends safety relationships reference other users, not personal workout backup data',
  zane_social_groups: 'private social groups reference other users, not personal workout backup data',
  zane_social_group_members: 'private social group membership reference other users, not personal workout backup data',
  zane_social_messages: 'social conversations reference other users, not personal workout backup data',
  zane_social_message_attachments: 'social message media metadata and storage objects are server-side conversation data',
  zane_social_message_reads: 'social conversation read receipts are device/server state, not workout content',
  zane_social_plan_shares: 'plan shares are immutable cross-user snapshots, not part of the sender backup',
  zane_social_plan_share_imports: 'plan-share import receipts are cross-user social state, not personal workout backup data',
  zane_social_reports: 'moderation reports are server-side safety records, not personal workout backup data',
  zane_social_workout_comments: 'friends workout comments and cheers reference other users, not personal workout backup data',
  zane_social_notification_deliveries: 'server-side Friends push delivery ledger, derived provider state rather than user content',
  zane_social_notification_attempts: 'server-side Friends rate-limit window, derived operational state rather than user content',
  zane_invite_attempts: 'per-caller invite throttle for invite_client, operational state, never user content',
  zane_foods: 'shared/global reference cache (Open Food Facts/USDA), not per-user data',
  zane_recipe_shares: 'recipe share-link snapshots (RPC-only); an adopted share becomes a normal zane_food_recipes row',
  zane_food_template_days: 'derived per-day auto-fill markers, device/sync state regenerated as needed (not user content)',
  zane_medication_pillbox_checks: 'derived per-week pack-check markers, device/sync state regenerated as needed (not user content)',
  zane_meal_reminder_deliveries: 'server-side reminder delivery ledger, derived provider state rather than user content',
};

// Columns that legitimately never round-trip.
const GLOBAL_ALLOW = new Set(['user_id', 'created_at', 'updated_at', 'next_reminder_at']);
const PER_TABLE_ALLOW = {
  // completed_server_at: server-stamped and client-unwritable by design (it is
  // what makes the founding-member day spread forgery-resistant). Restoring it
  // from a user-editable backup file would hand that back.
  zane_sessions: new Set(['entries', 'completed_server_at']),  // entries: legacy JSONB, never written (relational is source of truth)
  // sw_version: internal client marker. auto_close_notify / manual_calories: not
  // part of the store model (never loaded/synced), so nothing to round-trip; add
  // them to loadFromSupabase + the store if they ever become real settings.
  // tz_offset_minutes/time_zone: environment-derived, auto-set by the client on load.
  // water_last_push_at: server-written throttle for the water reminder cron.
  // daily_log_reminder_last_date: server-written per-day throttle for the
  // daily-log-reminder cron, same status as water_last_push_at.
  zane_user_settings: new Set(['sw_version', 'auto_close_notify', 'manual_calories', 'tz_offset_minutes', 'time_zone', 'water_last_push_at', 'daily_log_reminder_last_date']),
  // tier / tier_granted_at: server-authored, granted by grant_lifetime_if_qualified()
  // and reverted on any client write by zane_profiles_protect_tier. Deliberately
  // NOT restorable: a backup file is user-editable, so importing it would be a
  // free "set tier = lifetime" for anyone willing to edit one line of JSON.
  zane_profiles: new Set(['tier', 'tier_granted_at']),
};
const allowed = (table, col) =>
  GLOBAL_ALLOW.has(col) || (PER_TABLE_ALLOW[table] && PER_TABLE_ALLOW[table].has(col));

// Settings columns with no live-sync counterpart by design: they still round-trip
// through backup import/export (checked above), just never through syncStore.
const SETTINGS_SYNC_ALLOW = new Set([
  'vip_background', // admin-granted only (set_user_vip_background RPC); the client itself never writes it
]);

// ── Schema truth ─────────────────────────────────────────────────────────────
const schemaTables = parseSchemaTables(read('supabase/schema.sql'));

// ── IMPORT coverage: run importFromBackup with a recording Supabase stub ──────
function captureImportedColumns() {
  const written = {}; // table -> Set(columns)
  const okP = () => Promise.resolve({ data: [], error: null });
  const record = (table, rows) => {
    const arr = Array.isArray(rows) ? rows : [rows];
    if (!written[table]) written[table] = new Set();
    for (const r of arr) for (const k of Object.keys(r || {})) written[table].add(k);
  };
  const builder = (table) => {
    const b = {
      select: () => b, eq: okP, in: okP, gte: () => b, order: okP,
      is: () => b, neq: () => b, not: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      delete: () => b,
      upsert: (rows) => { record(table, rows); return okP(); },
      insert: (rows) => { record(table, rows); return okP(); },
    };
    return b;
  };
  const client = {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t) => builder(t),
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  const sandbox = {
    window: { supabase: { createClient: () => client }, addEventListener() {} },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    console, fetch: async () => ({ ok: true }), setTimeout, clearTimeout, Math, Date, JSON,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/store.js'), sandbox, { filename: 'store.js' });
  const LB = sandbox.window.LB;

  // A minimal but structurally complete backup: one row per table so every
  // per-table upsert runs. Values are irrelevant: the mapped upserts include
  // each column (defaulting to null), so the recorded keys are the full set.
  const backup = {
    user: { name: 'x' },
    exercises: [{ id: 'e1', name: 'Ex', tags: [] }],
    schedules: [{ id: 'sc1', days: [] }],
    sessions: [{ id: 's1', date: '2026-01-01', entries: [{ exId: 'e1', name: 'Ex', sets: [{ kg: 1, reps: 1 }] }] }],
    settings: {},
    skips: [{}], cardioLogs: [{}], dailyLogs: [{}], workoutTemplates: [{}],
    glucoseLogs: [{}], cardioPlans: [{}], statusPeriods: [{}], mesoStates: [{}],
    checkinSchemaTemplates: [{}], bloodPressureLogs: [{}], bodyTempLogs: [{}],
    waterLogs: [{}], adaptiveTdeeHistory: [{ asOfDate: '2026-01-01', windowStart: '2025-12-19', windowEnd: '2026-01-01', tdee: 2000, avgCalories: 1900, weightStartKg: 80, weightEndKg: 79.5, weightChangeKg: -0.5, weightRateKgWeek: -0.25, daySpan: 10, calorieDays: 5, weighIns: 6 }], foodLogs: [{}], foodFavorites: [{}], foodRecipes: [{}],
    foodTemplateSlots: [{}], foodMealPlans: [{}], foodShoppingPrefs: [{}],
    medicationPlans: [{}], medications: [{}], medicationPlanItems: [{}], medicationScheduleSlots: [{}], medicationLogs: [{}],
    activeScheduleId: null, activeMealTemplateId: null, cycleIndex: 0, customDayTypes: [],
  };
  return LB.importFromBackup(backup, 'u1', () => {}).then(() => written);
}

// ── EXPORT coverage: which columns store.js ever SELECTs per table ────────────
function parseSelectedColumns(src) {
  const selected = {};      // table -> Set(columns)
  const star = new Set();   // tables fetched with '*' (directly or as a join)
  for (const m of src.matchAll(/from\('(zane_\w+)'\)\s*\.select\('([^']*)'\)/g)) {
    const [, table, cols] = m;
    if (!selected[table]) selected[table] = new Set();
    for (const raw of cols.split(',')) {
      const tok = raw.trim();
      if (!tok) continue;
      if (tok === '*' || tok.startsWith('*')) { star.add(table); continue; }
      // strip alias ("date:foo") and embedded relations ("sets:zane_sets(*)")
      if (tok.includes('(') || tok.includes(':')) continue;
      selected[table].add(tok.replace(/"/g, ''));
    }
  }
  // Nested relation selects like "sets:zane_sets(*)" load the whole child table.
  for (const m of src.matchAll(/(zane_\w+)\(\*\)/g)) star.add(m[1]);
  return { selected, star };
}

// ── SYNC coverage: does a setting loadFromSupabase maps actually reach live
// cross-device sync (settingsChanged's diff + syncStore's upsert), not just a
// backup round-trip? ─────────────────────────────────────────────────────────

// zane_user_settings columns loadFromSupabase actually maps into the store,
// db column -> store field. Scoped to the function body rather than
// src.matchAll over the whole file: the generic "key: sett.col" shape only
// means what we think it means there, other tables' row mappers elsewhere in
// this file use their own "l."/"m."/"p." variables and could otherwise collide.
function parseLoadedSettingsColumns(src) {
  const start = src.indexOf('async function loadFromSupabase(');
  const end = src.indexOf('\nasync function autoArchiveMissedDays(', start);
  const mapStart = src.indexOf('function mapUserSettings(');
  const mapEnd = src.indexOf('\nfunction ', mapStart + 1);
  const body = src.slice(start, end) + '\n' + (mapStart >= 0 ? src.slice(mapStart, mapEnd > mapStart ? mapEnd : undefined) : '');
  const map = new Map(); // db column -> store field
  // ".*?" so a wrapped value (normalizeHiddenHealthCards(sett.x), the
  // Array.isArray(sett.x) ? sett.x : [] ternaries) still resolves to its own
  // key instead of being skipped for not being a bare "key: sett.x".
  for (const m of body.matchAll(/^\s*(\w+):\s*.*?\bsett\.(\w+)/gm)) map.set(m[2], m[1]);
  return map;
}

// Store-field keys (camelCase) referenced in syncStore's settingsChanged diff:
// both "next.settings?.x" and top-level "next.x" for the handful of
// settings-table columns modeled outside store.settings (activeScheduleId,
// statusMode, and similar plan-position/status fields).
function parseSettingsChangedKeys(src) {
  const start = src.indexOf('const settingsChanged =');
  const end = src.indexOf(';', start);
  const expr = src.slice(start, end);
  return new Set([...expr.matchAll(/next\.(?:settings\?\.)?(\w+)/g)].map(m => m[1]));
}

// DB columns (snake_case) actually written by syncStore's live upsert: the
// unconditional settingsRow literal, plus columns added afterwards only when
// changed (water/plan-position fields, gated so a stale device can't clobber
// a fresher cross-device value, see the comments in syncStore itself).
function parseSyncUpsertColumns(src) {
  const fnStart = src.indexOf('async function syncStore(');
  const start = src.indexOf('const settingsRow = {', fnStart);
  const end = src.indexOf('.upsert(settingsRow)', start);
  const body = src.slice(start, end);
  const cols = new Set([...body.matchAll(/^\s*(\w+):/gm)].map(m => m[1]));
  for (const m of body.matchAll(/\bsettingsRow\.(\w+)\s*=/g)) cols.add(m[1]);
  return cols;
}

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  const storeSrc = read('src/store.js');
  const { selected, star } = parseSelectedColumns(storeSrc);

  let written;
  try {
    written = await captureImportedColumns();
  } catch (e) {
    console.error('check-backup-coverage: could not run importFromBackup in the sandbox');
    console.error('  ' + (e && e.stack ? e.stack : e));
    process.exit(2);
  }

  const importGaps = {}; // table -> [cols]
  const exportGaps = {}; // table -> [cols]

  // Table-level: every zane_ table must be classified.
  const classified = new Set([...BACKUP_ENUM, ...PASSTHROUGH, ...Object.keys(EXCLUDED)]);
  const unclassified = [...schemaTables.keys()].filter(t => t.startsWith('zane_') && !classified.has(t));

  const checkExport = (table) => {
    if (star.has(table)) return [];
    const sel = selected[table] || new Set();
    return [...schemaTables.get(table)].filter(c => !allowed(table, c) && !sel.has(c)).sort();
  };

  for (const table of BACKUP_ENUM) {
    if (!schemaTables.has(table)) continue;
    const cols = schemaTables.get(table);
    const w = written[table] || new Set();
    const missImport = [...cols].filter(c => !allowed(table, c) && !w.has(c)).sort();
    if (missImport.length) importGaps[table] = missImport;
    const missExport = checkExport(table);
    if (missExport.length) exportGaps[table] = missExport;
  }
  for (const table of PASSTHROUGH) {
    if (!schemaTables.has(table)) continue;
    const missExport = checkExport(table);
    if (missExport.length) exportGaps[table] = missExport;
  }

  // SYNC gaps: a zane_user_settings column loadFromSupabase maps into the
  // store, but settingsChanged and/or syncStore's live upsert never mention,
  // so a change to it round-trips through a backup yet never reaches another
  // device.
  const settingsChangedGaps = [];
  const settingsUpsertGaps = [];
  const loadedSettings = parseLoadedSettingsColumns(storeSrc);
  const changedKeys = parseSettingsChangedKeys(storeSrc);
  const upsertCols = parseSyncUpsertColumns(storeSrc);
  for (const [dbCol, field] of loadedSettings) {
    if (allowed('zane_user_settings', dbCol) || SETTINGS_SYNC_ALLOW.has(dbCol)) continue;
    if (!changedKeys.has(field)) settingsChangedGaps.push(dbCol);
    if (!upsertCols.has(dbCol)) settingsUpsertGaps.push(dbCol);
  }
  settingsChangedGaps.sort();
  settingsUpsertGaps.sort();

  const hasGaps = unclassified.length || Object.keys(importGaps).length || Object.keys(exportGaps).length
    || settingsChangedGaps.length || settingsUpsertGaps.length;

  if (!hasGaps) {
    const n = BACKUP_ENUM.length + PASSTHROUGH.length;
    console.log(`check-backup-coverage OK: ${n} backup tables round-trip every column (${Object.keys(EXCLUDED).length} tables excluded by design), and every loaded setting stays wired into live sync`);
    return;
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  console.error('check-backup-coverage: backup export/import has drifted from schema.sql\n');
  if (unclassified.length) {
    console.error('UNCLASSIFIED TABLES (decide: backup or exclude):');
    for (const t of unclassified) console.error(`  - ${t}`);
    console.error('');
  }
  if (Object.keys(importGaps).length) {
    console.error('IMPORT gaps (importFromBackup does not restore these columns):');
    for (const [t, cols] of Object.entries(importGaps)) console.error(`  - ${t}: ${cols.join(', ')}`);
    console.error('');
  }
  if (Object.keys(exportGaps).length) {
    console.error('EXPORT gaps (loadFromSupabase never SELECTs these, so they are not exported):');
    for (const [t, cols] of Object.entries(exportGaps)) console.error(`  - ${t}: ${cols.join(', ')}`);
    console.error('');
  }
  if (settingsChangedGaps.length) {
    console.error('SETTINGSCHANGED gaps (syncStore never diffs these, so a change never triggers a live sync):');
    console.error(`  - zane_user_settings: ${settingsChangedGaps.join(', ')}`);
    console.error('');
  }
  if (settingsUpsertGaps.length) {
    console.error('SYNC UPSERT gaps (syncStore never writes these, so a change never reaches the server live):');
    console.error(`  - zane_user_settings: ${settingsUpsertGaps.join(', ')}`);
    console.error('');
  }

  // ── Ready-to-paste fix prompt for Claude ──────────────────────────────────────
  const line = '─'.repeat(72);
  const p = [];
  p.push(line);
  p.push('PROMPT FOR CLAUDE (copy-paste to fix the backup drift):');
  p.push(line);
  p.push('The data backup in src/store.js has drifted from the DB schema');
  p.push('(supabase/schema.sql). Make a backup round-trip EVERY user column.');
  p.push('');
  if (unclassified.length) {
    p.push(`New table(s) not yet handled by the backup: ${unclassified.join(', ')}.`);
    p.push('For each, either add it to importFromBackup + loadFromSupabase + exportBackup');
    p.push('(and to BACKUP_ENUM/PASSTHROUGH in tools/check-backup-coverage.cjs), or, if it');
    p.push('is not personal data, add it to EXCLUDED there with a reason.');
    p.push('');
  }
  if (Object.keys(importGaps).length) {
    p.push('IMPORT: in importFromBackup(), add these columns to the upsert row for each');
    p.push('table, mapping the snake_case DB column to its camelCase backup field:');
    for (const [t, cols] of Object.entries(importGaps)) p.push(`  - ${t}: ${cols.join(', ')}`);
    p.push('  For zane_user_settings, a new setting must be added in ALL of: loadFromSupabase');
    p.push('  (DB->store), the settingsChanged check in syncStore, the settings upsert in');
    p.push('  syncStore, AND the settingsRow in importFromBackup (see CLAUDE.md, "Store").');
    p.push('');
  }
  if (Object.keys(exportGaps).length) {
    p.push('EXPORT: in loadFromSupabase(), add these columns to the relevant .select(...) so');
    p.push('they reach the store and get exported:');
    for (const [t, cols] of Object.entries(exportGaps)) p.push(`  - ${t}: ${cols.join(', ')}`);
    p.push('');
  }
  if (settingsChangedGaps.length || settingsUpsertGaps.length) {
    p.push('SYNC: these zane_user_settings columns are mapped by loadFromSupabase but never');
    p.push('propagate live between devices. In syncStore() (src/store.js), add:');
    if (settingsChangedGaps.length) p.push(`  - the settingsChanged diff: ${settingsChangedGaps.join(', ')}`);
    if (settingsUpsertGaps.length) p.push(`  - the settingsRow upsert: ${settingsUpsertGaps.join(', ')}`);
    p.push('  A new setting needs all FOUR spots: loadFromSupabase (DB->store), the');
    p.push('  settingsChanged check in syncStore, the settings upsert in syncStore, AND the');
    p.push('  settingsRow in importFromBackup (see CLAUDE.md, "Store").');
    p.push('');
  }
  p.push('If a column is intentionally excluded, do NOT map it: instead add it to the');
  p.push('allowlist (GLOBAL_ALLOW / PER_TABLE_ALLOW), SETTINGS_SYNC_ALLOW (settings with no');
  p.push('live-sync counterpart by design), or EXCLUDED in tools/check-backup-coverage.cjs');
  p.push('with a short reason.');
  p.push('');
  p.push('Then verify:  node tools/check-backup-coverage.cjs   (must print OK)');
  p.push(line);
  console.error(p.join('\n'));

  process.exit(1);
})();
