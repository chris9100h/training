#!/usr/bin/env node
// Contract checks for the coach-before-client and self-coaching Drive path.
// This is intentionally offline: the migration is exercised against a preview
// or production branch separately, while this catches accidental reintroduction
// of the old external-client-only gates in CI.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260818065553_coaching_drive_self_coaching.sql');
const photoFixMigration = read('supabase/migrations/20260818065644_coaching_drive_self_coaching_photo_fix.sql');
const edge = read('supabase/functions/coaching-drive-sync/index.ts');
const settings = read('src/screens-settings.jsx');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exportFn = migration.match(/CREATE OR REPLACE FUNCTION public\.enqueue_coaching_drive_export\(\)[\s\S]*?\$function\$;/i)?.[0] || '';
const photoFn = migration.match(/CREATE OR REPLACE FUNCTION public\.enqueue_coaching_drive_photo_export\(\)[\s\S]*?\$function\$;/i)?.[0] || '';

assert(exportFn && photoFn, 'self-coaching migration must replace both Drive queue triggers');
assert(!/coach_id\s*<>\s*client_id/i.test(exportFn), 'check-in export trigger still excludes self-coaching');
assert(!/coach_id\s*<>\s*client_id/i.test(photoFn), 'photo export trigger still excludes self-coaching');
assert(photoFixMigration.includes('VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.checkin_id, v_week)'), 'photo trigger fix must use the check-in week');
assert(/c\.status\s*=\s*'active'/i.test(exportFn) && /c\.status\s*=\s*'active'/i.test(photoFn), 'queue triggers must require an active relationship');
assert(/canUseCoachDrive/.test(edge) && /show_coaching_tab/.test(edge) && /be_your_own_coach/.test(edge), 'Edge role gate must allow the explicit coach workspace and self-coaching');
assert(/queueBackfill[\s\S]*?zane_coaching\?coach_id=eq\.[\s\S]*?status=eq\.active&select=id,client_id/.test(edge), 'Drive backfill must include self-coaching rows');
assert(/hasSelfCoachRole/.test(settings) && /showCoachingTab/.test(settings), 'Settings must expose Drive for self-coaching and pre-client coach mode');

console.log('test-coaching-drive-self OK');
