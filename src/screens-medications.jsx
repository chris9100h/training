/* Medications tracker: a personal (optionally coach-managed) log/schedule/
   inventory system for medications, vitamins and supplements, modeled closely
   on the Food Tracker's Plan Mode (zane_food_meal_plans/zane_food_template_
   slots/zane_food_logs, see screens-food.jsx) but with its own weekday-based
   schedule (not tied to training/rest day type) and its own inventory unit
   (unit_label, not always grams).

   Three tabs:
   - Timeline: today's doses (auto-filled from active schedule slots of
     active plans, same planned/logged distinction as food), plus logging an
     ad-hoc dose. A hero (doseTally/MdDoseRing) sits above the hour grid,
     same BracketFrame-plus-ring shape as the Water tracker's own daily hero
     (screens-water.jsx): a taken/due ring for whichever day curDate is
     currently on, counting only entries tied to a real schedule slot (an
     ad-hoc extra dose was never "due" in the first place). An hour row with
     more than one still-due dose gets a second small button under its own
     "+" (checkAllHour): several doses at the same hour are usually taken
     together, so a single confirm marks every still-due one in that hour as
     taken instead of checking each one off by hand.
   - Schedule: named plans (My Plans / Client Templates for a coach, like
     FoodTemplateScreen). A medication's membership in a plan is many-to-many
     via zane_medication_plan_items (store.medicationPlanItems, migration
     0221): the SAME medication (one shared identity/stock row) can sit in
     several plans at once, each with its OWN schedule (a schedule slot is
     scoped to one specific (medication, plan) pair via its own
     medicationPlanId), so a coach-prescribed cycle plan can prescribe a
     different dose/timing for a medication than the user's own separate
     plan for that same product. A plan's own "Add medication" is a
     multi-pick picker (mirrors ExercisePicker, screens-schedule.jsx: tap
     toggles a row into addPlanSelected instead of attaching immediately, a
     bottom "Add N" button confirms the whole batch, its own inline search +
     category pills narrow the list) over medications not already IN THIS
     plan (any medication is eligible, whether or not it's already a member
     of some other plan), never a create form, so removing a medication from
     a plan, or deleting the plan itself, never destroys the medication, its
     OTHER plans' schedules, or its log history, only this plan's own
     membership + this plan's own schedule slots for it. A plan also has its
     own `active` toggle (default on): only an active plan's schedule slots
     fire into the Timeline, several plans can be active at once by design
     (no single active pointer, see zane_medication_plans in
     docs/database.md). A schedule slot's own weekday/hour/dose fields (the
     "Add time" sub-sheet) are the one place time itself is entered; there
     is no separate per-slot pause toggle (removed, found confusing): the
     only way to stop a dose is removing the medication from that plan,
     which schedMed's own "Remove from plan" button does directly (the
     other route, medSheet's per-membership list in Inventory > Medications,
     stays too, but that's several taps from where the user is actually
     looking at this plan's schedule). schedMed's titleRight button opens
     "Move to plan" (moveTargetPlans/moveMedicationToPlan) instead: reassigns
     the existing membership row's medicationPlanId plus every one of this
     plan's own slots for it to a different plan of the same bucket, so
     reorganizing (e.g. peptides mixed into a Gear plan moved out into their
     own Peptides plan) carries the whole schedule over instead of the user
     rebuilding it by hand.
   - Inventory: two sub-tabs, Medications first/default and Stock second,
     mirroring the Food Shopping List's own Shopping List/Inventory split.
     Both share one search+filter row (renderSearchAndFilterRow: a name/
     brand search box plus a Filter sheet for category/in-a-plan/tracked,
     mirroring the Exercises library's own search+filter pattern exactly),
     since they're just two lenses on the exact same underlying
     inventoryList; the sub-tab id for Stock stayed 'inventory' when its
     label was renamed (only the label changed, not the id, so existing
     invSubTab checks didn't need touching). Stock is the stock/low-stock
     view (its own dedicated stockSheet is the only place stock is
     entered), every non-archived medication (not just stock-tracked ones,
     unlike the Shopping List's own Inventory tab: this domain's medication
     list IS the inventory, there's no separate frequency-filtered "staple"
     concept sitting in front of it), with a Running Low section for
     anything that's dipped under its package size. Medications is the
     actual create/edit/delete surface for a medication's identity (name,
     brand, category, unit, package size) ONLY, independent of any plan,
     same list as Stock just presented for editing rather than for stock
     levels.

   Identity and schedule are strictly entry-point-specific, never mixed into
   one sheet: medSheet (Inventory > Medications) is name/brand/category/unit/
   package size plus a list of current plan memberships (each individually
   removable)/Delete/Save, full stop, never stock (Inventory tab's own
   stockSheet) and never a schedule section, even for an already-saved
   medication. schedMed (a plan's own detail view, Schedule tab) is the
   opposite: the medication's name as a read-only title plus THIS plan's own
   schedule slots for it and "Add time", never an identity field, never
   another plan's slots for the same medication. renderMedListRow's mode
   option ('identity' default vs 'schedule') plus its planId option (schedule
   mode only) route a tapped row to whichever sheet, and whichever plan's
   schedule, its entry point calls for.

   Coach access mirrors the Food Tracker's meal-plan push exactly
   (LB.pushMedicationPlanToClient, store.js): coach-of-client RLS gives full
   read/write on all five tables, a coach VIEWS a client's medications via its
   own direct query (ClientMedicationsTab, screens-coaching-detail.jsx), same
   split as ClientNutritionTab/pushMealPlanToClient. */

const { useState: useStateMd, useEffect: useEffectMd, useMemo: useMemoMd, useRef: useRefMd } = React;

// Own copy of fdShiftDate (screens-food.jsx), same reasoning as MdCheckbox:
// that one is private to the Food Tracker's own module scope.
function mdShiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return LB.fmtISO(d);
}

// Same "day streak" idiom as Water's own hero (wtStreak, screens-water.jsx),
// with one deliberate difference: a day with nothing due (due === 0, e.g. a
// Mon/Wed/Fri-only supplement on a Tuesday) is skipped rather than breaking
// the streak. Water has the same goal every single day, so a missing day is
// unambiguously a miss; a medication schedule is inherently day-specific, and
// due === 0 is the normal, expected shape of an off day, not a lapse. If
// today's own doses aren't all in yet, start counting from yesterday instead
// (mirrors wtStreak too): a dose scheduled for tonight shouldn't zero out an
// otherwise intact streak while the day is still in progress. Capped well
// past any realistic streak so an empty/near-empty schedule can't spin this
// loop for years of all-zero days.
function mdStreak(store, todayISO) {
  const todayTally = LB.dsMedsDueTaken(store, todayISO);
  let streak = 0;
  let offset = (todayTally.due > 0 && todayTally.taken < todayTally.due) ? -1 : 0;
  for (let guard = 0; guard < 400; guard++) {
    const dateISO = mdShiftDate(todayISO, offset);
    const { due, taken } = LB.dsMedsDueTaken(store, dateISO);
    if (due === 0) { offset--; continue; }
    if (taken < due) break;
    streak++;
    offset--;
  }
  return streak;
}

// ── Style constants (own copies, mirrors screens-food.jsx's fd* helpers) ──
const mdListRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const mdQuickRowInner = { ...mdListRow, flex: 1, minWidth: 0 };
const mdEntryName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const mdEntryMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi };
// Weekly Prep's own per-day dose count: bold and accent instead of
// mdEntryMeta's small faint treatment so it stands out, but capped at
// mdEntryName's own size, going any bigger read as oversized/weird next to
// the medication name it belongs to.
const mdPerDayQty = { fontSize: 13, fontWeight: 700, color: UI.gold, fontFamily: UI.fontUi, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' };
const mdEmptyHint = { fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '18px 8px', lineHeight: 1.5 };
const mdInputStyle = {
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
  color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, padding: '10px 12px', width: '100%',
  WebkitAppearance: 'none', boxSizing: 'border-box', textShadow: 'none',
};
const mdTopAddBtn = {
  width: 34, height: 34, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
};
const mdEditBtn = {
  background: 'transparent', border: `var(--hair-width) solid ${UI.hairStrong}`,
  borderRadius: 4, padding: '5px 12px', cursor: 'pointer', color: UI.inkSoft,
};
// Small tag-pill badge, mirrors the recurring gold/neutral tag pattern in the
// Training Plan list's own cards (screens-schedule.jsx), no shared helper
// exists there either (each is hand-inlined), named here since Medications
// only needs the one shape.
function mdTagPill(gold) {
  return {
    fontFamily: UI.fontNum, fontSize: 10, fontWeight: 700,
    color: gold ? UI.gold : UI.inkSoft,
    background: gold ? 'rgba(var(--accent-rgb),0.15)' : UI.bgInset,
    border: `1px solid ${gold ? UI.goldSoft : UI.hairStrong}`,
    borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em',
  };
}
function mdSegBtn(active) {
  return {
    flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-ink)' : UI.inkFaint,
    textShadow: active ? 'none' : 'var(--text-lift)',
    fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
    WebkitTapHighlightColor: 'transparent',
  };
}
// Timeline date-switcher + hour-grid style helpers, own copies of
// fdNavBtn/fdIconBtn/FdHourTrunk/FdHourTick/fdHourRow/fdHourLabelCol/
// fdHourAddBtn (screens-food.jsx), same "own copy" reasoning as MdCheckbox.
function mdNavBtn() {
  return {
    width: 32, height: 32, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
    background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  };
}
function mdIconBtn(size) {
  return {
    flexShrink: 0, width: size, height: size, borderRadius: 4,
    border: `var(--hair-width) solid ${UI.hairStrong}`,
    background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  };
}
const MD_HOUR_GUTTER = 16;
function MdHourTrunk() {
  return <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 2, background: UI.hairStrong, pointerEvents: 'none' }} />;
}
function MdHourTick() {
  return (
    <div style={{ width: MD_HOUR_GUTTER, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      <div style={{ marginLeft: 6, width: MD_HOUR_GUTTER - 6, height: 2, background: UI.hairStrong }} />
    </div>
  );
}
function mdHourRow(filled, isNow) {
  return {
    display: 'flex', alignItems: 'center', gap: 10, borderRadius: 6,
    border: `var(--hair-width) solid ${isNow ? 'var(--hair-accent)' : UI.hairStrong}`,
    background: isNow ? 'rgba(var(--accent-rgb),0.07)' : UI.bgInset,
    padding: filled ? '10px 10px' : '8px 10px',
  };
}
const mdHourLabelCol = { width: 24, flexShrink: 0, textAlign: 'right' };
function mdHourAddBtn(isNow) {
  return {
    flexShrink: 0, width: 30, height: 30, borderRadius: 4,
    border: `var(--hair-width) solid ${isNow ? 'var(--hair-accent)' : UI.hairStrong}`,
    background: 'transparent', color: isNow ? 'var(--accent)' : UI.inkSoft,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };
}

// ── Constants ──
// Free text on zane_medications.category (no DB CHECK), these are just the
// UI's own presets, a new category never needs a migration.
const MED_CATEGORIES = [
  { id: 'vitamin', label: 'Vitamin' },
  { id: 'compound', label: 'Compound' },
  { id: 'peptide', label: 'Peptide' },
  { id: 'other', label: 'Other' },
];
// Index matches LB.isoWd (store.js: 0=Mon..6=Sun), the same weekday
// convention zane_schedules weekday plans already use.
const MD_WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MD_WEEKDAYS_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function mdCategoryLabel(id) {
  return MED_CATEGORIES.find(c => c.id === id)?.label || id || null;
}
function mdNum(v) { return (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(v); }
function mdDecimalFilter(raw) {
  let v = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 1);
  return v;
}
// Never rounds (a dose/stock count is an exact fact, not an estimate, same
// reasoning as fdExactShoppingQty in screens-food.jsx): trims to at most 2
// decimals and drops trailing zeros so a whole number still reads as one.
function mdFmtQty(n, unitLabel) {
  if (n == null) return '';
  const trimmed = parseFloat(Number(n).toFixed(2));
  return `${trimmed} ${unitLabel || 'pills'}`;
}

// Mirrors fdConsumedSince (screens-food.jsx) exactly, one field name over:
// compares real Date moments (entry.date/.time, both local, against the full
// sinceISO instant) rather than calendar dates alone, so a same-day dose
// logged BEFORE the stock baseline was set doesn't get wrongly deducted.
function mdConsumedSince(medicationLogs, medicationId, sinceISO, todayISO) {
  const sinceMoment = new Date(sinceISO);
  let total = 0;
  (medicationLogs || []).forEach(entry => {
    if (entry.medicationId !== medicationId) return;
    if (entry.planned || entry.date > todayISO) return;
    if (new Date(`${entry.date}T${entry.time || '00:00'}:00`) < sinceMoment) return;
    total += entry.doseQty || 0;
  });
  return total;
}
// Derived (not live-decremented) current stock, same principle as
// zane_food_shopping_prefs: current = stockBaseline minus everything logged
// since stockSetAt, computed at read time. No hook needed in any logging
// path, self-corrects if a log entry is later edited or deleted.
function mdEffectiveStock(med, medicationLogs, todayISO) {
  if (med?.stockBaseline == null || !med.stockSetAt) return null;
  return Math.max(0, med.stockBaseline - mdConsumedSince(medicationLogs, med.id, med.stockSetAt, todayISO));
}
// Below the effective threshold: lowStockThreshold (migration 0233) when
// set, package size otherwise, only meaningful with stock tracking on, a
// medication with neither has nothing to compare its stock against. The
// override exists because "below one package" alone fires too late for
// something that gets used up faster than one package lasts, exact mirror
// of fdIsLowStock in screens-food.jsx. excludeFromLowStock (migration 0234,
// "Cycle only" in medSheet) short-circuits before any of that: stock
// tracking and the effectiveStock number itself stay fully on, only the
// warning is suppressed, for something being run for one cycle with no
// intent to reorder. trackStock (migration 0235, the "Track Medication
// Stock" master toggle) is checked first and is more fundamental still:
// off means this medication opted out of the whole tracking surface, not
// just the warning.
function mdIsLowStock(med, effectiveStock) {
  if (!med.trackStock || med.excludeFromLowStock) return false;
  const threshold = med.lowStockThreshold ?? med.packageSize;
  return threshold > 0 && effectiveStock != null && effectiveStock < threshold;
}
// Whether a medication currently belongs to at least one plan (migration
// 0221: membership is many-to-many via zane_medication_plan_items, no single
// medicationPlanId on the medication itself anymore).
function mdHasPlan(med, medicationPlanItems) {
  return medicationPlanItems.some(it => it.medicationId === med.id);
}

// A schedule slot applies to `dateISO` if its plan is active, (when set)
// dateISO falls inside its optional start/end date phase, and then either
// today's weekday is in its list, or, in interval mode (migration 0237,
// intervalDays set), dateISO lands exactly on a multiple of intervalDays
// since startDate. Both bounds null (the default, weekday mode) means
// unbounded, identical to a plain always-on schedule. There is no per-slot
// pause flag (removed, see the header comment): a slot with no plan, or
// whose plan isn't in activePlanIds, is simply never due, exactly as if it
// didn't exist, no separate "orphaned" handling needed.
// Interval mode has no unbounded case: startDate is its anchor, so a slot
// with intervalDays set but no startDate (shouldn't happen, saveSlotDraft
// requires one, but a synced row from elsewhere could still lack it) is
// simply never due rather than guessing an anchor.
// Lives in store.js as LB.dsSlotAppliesOn (used by the AI daily summary,
// which runs where this file isn't loaded) and exported from there so this
// file doesn't need its own hand-synced copy.
// Human-readable recurrence label for a schedule slot: "Every Nd" in
// interval mode, "Every day"/"Mon/Wed/Fri" in weekday mode. Shared by
// renderMedListRow's aggregate summary and schedMed's own per-slot list, so
// the two never drift on how this reads.
function mdSlotDaysLabel(slot) {
  if (slot.intervalDays > 0) return `Every ${slot.intervalDays}d`;
  return slot.weekdays.length === 7 ? 'Every day' : slot.weekdays.map(w => MD_WEEKDAY_SHORT[w]).join('/');
}
function mdMaterializeSlotEntry(med, slot, dateISO) {
  return {
    // Deterministic per (day, slot), same reasoning as fdMaterializeSlotEntry
    // (screens-food.jsx): two devices/tabs auto-filling the same due slot
    // before either has synced would otherwise mint different random ids,
    // and the purely id-keyed upsert would then insert both as permanent
    // duplicates instead of colliding into one row.
    id: `md_${dateISO}_${slot.id}`, medicationId: med.id, medicationName: med.name,
    date: dateISO, time: `${String(slot.hour).padStart(2, '0')}:00`,
    doseQty: slot.doseQty, planned: true, scheduleSlotId: slot.id,
  };
}
// Fills in today's due-but-missing doses from active schedule slots, same
// idea as the Food Tracker's own auto-fill effect. Checks scheduleSlotId
// against today's existing log rows (not just count) so a slot that already
// materialized isn't duplicated; a deliberately-deleted entry can reappear
// later the same day if some unrelated medications/scheduleSlots edit
// re-triggers the calling effect (no zane_food_template_days-style
// cross-device marker for this yet), an accepted v1 rough edge, not a
// correctness bug: at worst you see a stray "still due" row you can mark
// taken or ignore. See the effect below for why it can no longer happen
// simply from the delete itself.
function mdAutoFillToday(store, setStore, todayISO) {
  // Every current nav path into this screen already gates on showMeds
  // (derived from this same flag), but that's a UI-entry-point guard, not a
  // property of this function itself: a cross-device settings sync landing
  // mid-session while the screen is still mounted must not keep silently
  // materializing and syncing new doses for a feature the store just marked
  // disabled, same as the Food Tracker's own auto-fill effect gating on
  // planMode first.
  if (!store.settings?.medsEnabled) return;
  const wd = LB.isoWd(new Date());
  const medsById = new Map((store.medications || []).filter(m => !m.archived).map(m => [m.id, m]));
  const activePlanIds = new Set((store.medicationPlans || []).filter(p => p.active).map(p => p.id));
  const existingSlotIds = new Set(
    (store.medicationLogs || []).filter(l => l.date === todayISO && l.scheduleSlotId).map(l => l.scheduleSlotId)
  );
  const toAdd = [];
  (store.medicationScheduleSlots || []).forEach(slot => {
    const med = medsById.get(slot.medicationId);
    if (!med || existingSlotIds.has(slot.id)) return;
    if (!LB.dsSlotAppliesOn(slot, todayISO, wd, activePlanIds)) return;
    toAdd.push(mdMaterializeSlotEntry(med, slot, todayISO));
  });
  if (!toAdd.length) return;
  setStore(s => ({ ...s, medicationLogs: [...(s.medicationLogs || []), ...toAdd] }));
}
// Removes today's still-pending (planned: true) materialized rows for
// schedule slots that just stopped applying, because the plan they belong
// to was paused/deleted or the slot itself was deleted. Without this, a row
// mdAutoFillToday already wrote before the change stuck around: the hero
// tally (scheduleSlotId-only, no plan-state check) kept counting it as
// still due, and the medication-reminder cron (planned=eq.true, no
// plan-state join either) kept pushing a reminder for a stopped
// medication. Already-taken doses (planned: false, toggleTaken/
// checkAllHour flip it one-way) are real history, never touched, and
// nothing before today is either, mdAutoFillToday only ever materializes
// today's date to begin with.
function mdReconcilePlannedLogs(setStore, todayISO, invalidSlotIds) {
  if (!invalidSlotIds || !invalidSlotIds.size) return;
  setStore(s => ({
    ...s,
    medicationLogs: (s.medicationLogs || []).filter(l =>
      !(l.date === todayISO && l.planned && l.scheduleSlotId && invalidSlotIds.has(l.scheduleSlotId))
    ),
  }));
}

// Per-device (CLAUDE.md localStorage-keys list): which low-stock dip the
// user already saw the Running Low banner for, same keyed-by-stockSetAt
// pattern as the Shopping List's logbook-low-stock-acked (a later restock
// stamps a fresh stockSetAt, so the banner comes back on its own next time,
// no separate reset needed).
function mdReadLowStockAcks() {
  try {
    const v = JSON.parse(localStorage.getItem('logbook-med-low-stock-acked'));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (_) { return {}; }
}
function mdWriteLowStockAcks(v) {
  try { localStorage.setItem('logbook-med-low-stock-acked', JSON.stringify(v)); } catch (_) {}
}

// Include/exclude-style checkbox reused for the Timeline's "mark as taken"
// toggle, own copy of FdCheckbox (screens-food.jsx) since that one is
// private to the Food Tracker's own module scope by convention.
function MdCheckbox({ checked, onToggle, label }) {
  return (
    <button
      onClick={onToggle}
      aria-label={label || (checked ? 'Mark as not taken' : 'Mark as taken')}
      style={{
        width: 24, height: 24, flexShrink: 0, borderRadius: 4, padding: 0, cursor: 'pointer',
        border: `1.5px solid var(--accent)`,
        background: checked ? 'var(--accent)' : 'transparent',
        color: checked ? 'var(--accent-ink)' : 'transparent',
        textShadow: checked ? 'none' : 'var(--text-lift)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <i className="fa-solid fa-check" style={{ fontSize: 12 }} />
    </button>
  );
}

// Gold-bordered section label for the Stock filter sheet, own copy of
// GoldSectionLabel (screens-lib.jsx's own Exercises filter sheet, the
// pattern this mirrors) since that one is private to that module's own
// scope by convention.
function MdGoldLabel({ children, style }) {
  return (
    <div className="micro" style={{ borderLeft: `2px solid ${UI.gold}`, paddingLeft: 8, marginBottom: 10, ...style }}>
      {children}
    </div>
  );
}

// Timeline hero's progress ring, same SVG donut shape as WaterRing
// (screens-water.jsx) and FdRing (screens-food.jsx) so all three daily-total
// heroes read as the same idiom, own copy per that same convention. Unlike
// either of those (which center a percent), this one centers the raw
// "taken/due" fraction: a dose count reads more directly than a percentage
// for a small whole number of doses, the percent still drives how much of
// the ring fills. Flat accent color, not FdRing's traffic-light tiers: this
// whole screen is already gold-accented throughout, a second color system
// for one ring would be more machinery than a simple daily count needs.
function MdDoseRing({ taken, due, size = 104 }) {
  const percent = due > 0 ? Math.min(100, Math.round((taken / due) * 100)) : 0;
  const r = 50, circ = 2 * Math.PI * r;
  const offset = circ * (1 - percent / 100);
  const label = `${taken}/${due}`;
  // Unlike WaterRing/FdRing (always a 1-3 digit percent, "100%" is the worst
  // case), a dose count has no such ceiling: running several plans at once
  // easily reaches double digits on both sides ("12/12"), which overflowed
  // the ring at a fixed size. Shrink by label length instead of a fixed
  // fontSize.
  const fontSize = label.length <= 3 ? 26 : label.length === 4 ? 22 : label.length === 5 ? 18 : 15;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={UI.hair} strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={UI.gold} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="num" style={{ fontSize, fontWeight: 600, color: UI.gold, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>TAKEN</span>
      </div>
    </div>
  );
}

function MedicationsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const [screenTab, setScreenTab] = useStateMd('timeline'); // 'timeline' | 'schedule' | 'inventory'
  const [weeklyPrepOpen, setWeeklyPrepOpen] = useStateMd(false);

  const medications = store.medications || [];
  // Alphabetical at the source: every list/picker/dropdown built from this
  // (inventoryList, the plan-detail medication list, the Log-a-dose select,
  // ...) inherits the order for free instead of each needing its own sort.
  const activeMedications = useMemoMd(() => medications.filter(m => !m.archived).sort((a, b) => a.name.localeCompare(b.name)), [medications]);
  const medicationPlans = store.medicationPlans || [];
  const scheduleSlots = store.medicationScheduleSlots || [];
  const medicationLogs = store.medicationLogs || [];
  const medicationPlanItems = store.medicationPlanItems || [];

  const isCoach = (store.coaching?.asCoach || []).some(c => c.status === 'active');
  const coachClients = useMemoMd(() => (store.coaching?.asCoach || []).filter(c => c.status === 'active').sort((a, b) => (a.clientName || '').localeCompare(b.clientName || '')), [store.coaching]);

  // Auto-fill today's due doses. medicationLogs is deliberately NOT a
  // dependency: it is, unavoidably, since mdAutoFillToday only skips a slot
  // that already has a log row. If it were listed here, deleting an
  // auto-filled entry would change medicationLogs, re-trigger this very
  // effect, and mdAutoFillToday would see the slot as no-longer-represented
  // and materialize it right back, so a delete could never stick while its
  // slot is still due today. Same exclusion the Food Tracker's own
  // template-day effect makes for store.foodLogs, for the same reason.
  // store.medicationPlans IS a dependency though: mdAutoFillToday reads it
  // to build activePlanIds and gate every slot on its plan's active flag.
  // Without it, togglePlanActive reactivating a paused plan would update the
  // Timeline's own live preview (byHour already depends on medicationPlans
  // separately) but never re-run this effect, so the real log row never
  // materializes. If the user logs that dose by hand in the meantime,
  // saveLogDraft finds no materialized row to merge into and inserts an
  // ad-hoc one instead, and the next time this effect does run it still
  // sees the slot as unrepresented and materializes a genuine duplicate.
  useEffectMd(() => {
    mdAutoFillToday(store, setStore, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.medicationScheduleSlots, store.medications, store.medicationPlans, today]);

  // ─────────────────────────── Timeline tab ───────────────────────────
  // Same structure as the Food Tracker's own Log tab (screens-food.jsx): a
  // date switcher plus a full 0-23 hour grid that's always rendered, filled
  // or not, rather than an empty-state takeover on a day with nothing yet.
  const [curDate, setCurDate] = useStateMd(today);
  const dayLabel = curDate === today ? 'Today' : curDate === mdShiftDate(today, -1) ? 'Yesterday' : curDate === mdShiftDate(today, 1) ? 'Tomorrow' : LB.fmtDayLabel(curDate);
  const shiftDay = (delta) => setCurDate(d => mdShiftDate(d, delta));
  const curDateLogs = useMemoMd(
    () => medicationLogs.filter(l => l.date === curDate).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [medicationLogs, curDate],
  );
  const byHour = useMemoMd(() => {
    const map = {};
    // A real entry's medicationName is a snapshot taken at log/auto-fill
    // time (mdMaterializeSlotEntry, the log-a-dose submit): resolve it
    // against the CURRENT medication list first so a rename shows up
    // immediately everywhere, not just on days that haven't materialized a
    // real row yet (those fall through to the always-live preview path
    // below). Same full `medications` scope the dose's own unitLabel
    // lookup a few lines down already uses, so an archived-but-still-named
    // medication keeps showing its live name too; only a truly deleted one
    // falls back to the snapshot.
    const medsByIdAll = new Map(medications.map(m => [m.id, m]));
    curDateLogs.forEach(e => {
      const h = parseInt((e.time || '0:00').split(':')[0], 10) || 0;
      const med = medsByIdAll.get(e.medicationId);
      (map[h] = map[h] || []).push(med ? { ...e, medicationName: med.name } : e);
    });
    // Preview rows: schedule slots due on curDate with no real log yet, e.g.
    // a future day nobody's opened here before (mdAutoFillToday only ever
    // materializes TODAY, see its own comment), or a past day auto-fill
    // never ran for. Computed live from the schedule, never written to the
    // store: editing/deleting the slot is reflected immediately, and
    // nothing "logs" a dose that hasn't actually happened yet. Read-only
    // (no checkbox/delete in the render below), the hour's own "+" is still
    // there to log a real dose if the user wants one.
    const wd = LB.isoWd(new Date(curDate + 'T12:00:00'));
    const existingSlotIds = new Set(curDateLogs.filter(e => e.scheduleSlotId).map(e => e.scheduleSlotId));
    const medsById = new Map(activeMedications.map(m => [m.id, m]));
    const activePlanIds = new Set(medicationPlans.filter(p => p.active).map(p => p.id));
    scheduleSlots.forEach(slot => {
      const med = medsById.get(slot.medicationId);
      if (!med || existingSlotIds.has(slot.id)) return;
      if (!LB.dsSlotAppliesOn(slot, curDate, wd, activePlanIds)) return;
      (map[slot.hour] = map[slot.hour] || []).push({
        id: `preview_${curDate}_${slot.id}`, medicationId: med.id, medicationName: med.name,
        time: `${String(slot.hour).padStart(2, '0')}:00`, doseQty: slot.doseQty, planned: true,
        scheduleSlotId: slot.id, isPreview: true,
      });
    });
    // Alphabetical by medication name first (same convention as every other
    // name-based list in this module), exact time only as a tie-breaker:
    // real/preview rows in the same hour otherwise share the same or a
    // near-identical time, so sorting by time alone barely did anything.
    Object.keys(map).forEach(h => map[h].sort((a, b) => a.medicationName.localeCompare(b.medicationName) || (a.time || '').localeCompare(b.time || '')));
    return map;
    // medicationPlans is a real dependency, not just an incidental read: an
    // active/inactive toggle must immediately reflect here, otherwise
    // pausing/resuming a plan would silently wait for some unrelated
    // re-render before the Timeline's preview rows caught up. medications
    // (not just activeMedications) is a dependency too, for medsByIdAll's
    // live name resolution above.
  }, [curDateLogs, curDate, activeMedications, medications, scheduleSlots, medicationPlans]);
  // Timeline hero's own tally: only entries tied to a real schedule slot
  // count as "due" (an ad-hoc extra dose, scheduleSlotId null, was never due
  // in the first place, so it shouldn't inflate the denominator); planned:
  // false is "taken" (see toggleTaken/MdCheckbox), matching curDate exactly
  // like the hour grid below it, so browsing to another day shows that
  // day's own tally, not always literally today's.
  const doseTally = useMemoMd(() => {
    const scheduled = Object.values(byHour).flat().filter(e => e.scheduleSlotId);
    return { due: scheduled.length, taken: scheduled.filter(e => !e.planned).length };
  }, [byHour]);
  // Off store/today, not curDate: a streak is always "as of today", browsing
  // the day-switcher to some other date shouldn't change the number shown.
  const streak = useMemoMd(() => mdStreak(store, today),
    [store.medicationScheduleSlots, store.medicationLogs, store.medications, store.medicationPlans, today]);
  function toggleTaken(entry) {
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).map(l => l.id === entry.id ? { ...l, planned: !l.planned } : l) }));
  }
  // Bulk "mark as taken" for a whole hour row: several doses at the same
  // time are usually swallowed together, so checking each one off one at a
  // time is pure friction. One-way (like toggleTaken it flips planned to
  // false, never back to true): the individual checkboxes stay the way to
  // undo a single one afterward. Preview rows have no real log yet (see the
  // header comment on mdMaterializeSlotEntry) so they're never included;
  // already-taken entries are skipped rather than re-included, both for the
  // confirm copy's own count and so tapping this twice is a harmless no-op.
  async function checkAllHour(hour, entries) {
    const stillDue = entries.filter(e => !e.isPreview && e.planned);
    if (!stillDue.length) return;
    if (!await confirm(`Mark all ${stillDue.length} doses at ${String(hour).padStart(2, '0')}:00 as taken?`, { title: 'Mark all as taken', ok: 'Mark all', cancel: 'Cancel' })) return;
    const ids = new Set(stillDue.map(e => e.id));
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).map(l => ids.has(l.id) ? { ...l, planned: false } : l) }));
  }
  async function deleteLogEntry(entry) {
    if (!await confirm('Remove this entry from the timeline?', { title: 'Delete entry', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).filter(l => l.id !== entry.id) }));
  }

  const [logDraft, setLogDraft] = useStateMd(null); // { medicationId, doseQtyStr, hour } | null
  // hour is set when opened from a specific hour row's own "+" (logs at
  // exactly that hour); left null from the TopBar's generic "+" (logs at
  // the current wall-clock time), same distinction as Food's pendingHour.
  function openLogSheet(hour) {
    setLogDraft({ medicationId: activeMedications[0]?.id || '', doseQtyStr: '', hour: hour != null ? hour : null });
  }
  function saveLogDraft() {
    const med = medications.find(m => m.id === logDraft?.medicationId);
    const qty = mdNum(logDraft?.doseQtyStr);
    if (!med || !(qty > 0)) return;
    const time = logDraft.hour != null ? `${String(logDraft.hour).padStart(2, '0')}:00` : LB.nowHHMM();
    const hour = logDraft.hour != null ? logDraft.hour : parseInt(time.split(':')[0], 10);
    // If this medication already has a real, still-due scheduled dose in
    // this same hour today (materialized by mdAutoFillToday), mark THAT row
    // taken instead of inserting a second, disconnected entry: otherwise the
    // Timeline would show a confusing duplicate for the same dose, and the
    // hero/coach view (which only trust the scheduled row's own
    // scheduleSlotId) would still read it as not taken.
    const dueMatch = curDateLogs.find(l => l.medicationId === med.id && l.scheduleSlotId && l.planned
      && parseInt((l.time || '0:00').split(':')[0], 10) === hour);
    if (dueMatch) {
      setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).map(l => l.id === dueMatch.id ? { ...l, doseQty: qty, planned: false } : l) }));
      setLogDraft(null);
      return;
    }
    // mdAutoFillToday only ever materializes TODAY's due slots (see its own
    // comment), so dueMatch above can never find a real row on any other
    // date, even when the Timeline's own live preview (byHour below) is
    // already showing this exact dose as due. Without this, logging a
    // previewed dose on a past or future day always fell through to the
    // disconnected ad-hoc branch, leaving the original preview stuck "due"
    // forever and permanently undercounting that day's taken/due tally even
    // though the dose really was logged. Re-derive the same due-slot
    // answer byHour's own preview already computes and, if this logged dose
    // matches one, materialize the CANONICAL row for it (mdMaterializeSlotEntry,
    // the same deterministic id auto-fill itself would use) already marked
    // taken, instead of a random-id row with no scheduleSlotId.
    const wd = LB.isoWd(new Date(curDate + 'T12:00:00'));
    const existingSlotIds = new Set(curDateLogs.filter(l => l.scheduleSlotId).map(l => l.scheduleSlotId));
    const activePlanIds = new Set(medicationPlans.filter(p => p.active).map(p => p.id));
    const dueSlot = scheduleSlots.find(slot =>
      slot.medicationId === med.id && slot.hour === hour && !existingSlotIds.has(slot.id) &&
      LB.dsSlotAppliesOn(slot, curDate, wd, activePlanIds));
    const entry = dueSlot
      ? { ...mdMaterializeSlotEntry(med, dueSlot, curDate), doseQty: qty, planned: false }
      : { id: LB.uid(), medicationId: med.id, medicationName: med.name, date: curDate, time, doseQty: qty, planned: false, scheduleSlotId: null };
    setStore(s => ({ ...s, medicationLogs: [...(s.medicationLogs || []), entry] }));
    setLogDraft(null);
  }

  // ─────────────────────────── Schedule tab ───────────────────────────
  // Plans are named groupings a medication can belong to, many-to-many via
  // zane_medication_plan_items (store.medicationPlanItems, migration 0221):
  // the Inventory tab's own Medications sub-tab is the actual create/edit/
  // delete surface for the medication itself, independent of any plan, so
  // removing one from a plan (or deleting the plan) never has to destroy
  // it, its other plans' memberships/schedules, or its log history.
  const [planSubTab, setPlanSubTab] = useStateMd('mine'); // 'mine' | 'templates', coach bucket only
  const inBucket = p => !isCoach || (planSubTab === 'templates' ? !!p.isTemplate : !p.isTemplate);
  const plans = useMemoMd(() => medicationPlans.filter(p => !p.archived && inBucket(p)).sort((a, b) => a.name.localeCompare(b.name)), [medicationPlans, isCoach, planSubTab]);
  const [viewedPlanId, setViewedPlanId] = useStateMd(null);
  useEffectMd(() => {
    if (viewedPlanId && !plans.some(p => p.id === viewedPlanId)) setViewedPlanId(null);
  }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewedPlan = plans.find(p => p.id === viewedPlanId) || null;
  const viewedPlanMedIds = useMemoMd(
    () => new Set(medicationPlanItems.filter(it => it.medicationPlanId === viewedPlanId).map(it => it.medicationId)),
    [medicationPlanItems, viewedPlanId],
  );
  const viewedPlanMeds = useMemoMd(
    () => medications.filter(m => !m.archived && viewedPlanMedIds.has(m.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [medications, viewedPlanMedIds],
  );

  // "Add medication" from within a plan: pick one or more existing
  // medications not already a member of THIS plan (any medication is
  // eligible, whether or not it's already a member of some other plan, see
  // the header comment), or jump into medSheet to create a brand new one.
  // Attaching only ever inserts membership rows, it never creates the
  // medication itself, so a plan's own "Add medication" is always a picker,
  // never a create form. Multi-pick + its own search/category filter mirror
  // ExercisePicker (screens-schedule.jsx) exactly: tap toggles a row into
  // `addPlanSelected` (gold highlight + check-circle) instead of attaching
  // immediately, a bottom "Add N" button confirms the whole batch at once.
  const [addToPlanOpen, setAddToPlanOpen] = useStateMd(false);
  const [addPlanSearch, setAddPlanSearch] = useStateMd('');
  const [addPlanCategories, setAddPlanCategories] = useStateMd([]); // MED_CATEGORIES ids
  const [addPlanSelected, setAddPlanSelected] = useStateMd([]); // medication ids
  const availableToAddMeds = useMemoMd(
    () => activeMedications.filter(m => !viewedPlanMedIds.has(m.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [activeMedications, viewedPlanMedIds],
  );
  // Search/category narrow availableToAddMeds further, same relationship as
  // inventoryList -> filteredInventoryBase for the Inventory tab's own
  // search+filter: kept separate so the "every medication is already in
  // this plan" empty state (availableToAddMeds itself empty) reads
  // differently from "your search/filter matched nothing" (this one empty
  // but availableToAddMeds isn't).
  const filteredAvailableToAddMeds = useMemoMd(() => {
    const ql = addPlanSearch.trim().toUpperCase();
    return availableToAddMeds.filter(m => {
      const matchSearch = !ql || m.name.toUpperCase().includes(ql) || (m.brand || '').toUpperCase().includes(ql);
      const matchCategory = addPlanCategories.length === 0 || addPlanCategories.includes(m.category);
      return matchSearch && matchCategory;
    });
  }, [availableToAddMeds, addPlanSearch, addPlanCategories]);
  function toggleAddPlanCategory(c) {
    setAddPlanCategories(cats => cats.includes(c) ? cats.filter(x => x !== c) : [...cats, c]);
  }
  function toggleAddPlanSelect(id) {
    setAddPlanSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }
  // Fresh search/filter/selection every time the sheet is opened, so a
  // previous visit's narrowed-down search never silently carries into the
  // next one.
  function openAddToPlan() {
    setAddPlanSearch(''); setAddPlanCategories([]); setAddPlanSelected([]);
    setAddToPlanOpen(true);
  }
  function confirmAddToPlan() {
    if (!addPlanSelected.length) return;
    const nowISO = new Date().toISOString();
    setStore(s => ({
      ...s,
      medicationPlanItems: [
        ...(s.medicationPlanItems || []),
        ...addPlanSelected.map(medId => ({ id: LB.uid(), medicationPlanId: viewedPlanId, medicationId: medId, createdAt: nowISO })),
      ],
    }));
    setAddToPlanOpen(false);
  }
  // Shared row for a medication list: the plan-detail view opens the
  // schedule-only sheet (mode: 'schedule', planId: the plan being viewed),
  // the Medications tab opens the identity sheet (default) and additionally
  // lists every plan it's currently a member of. Both show name + category
  // + schedule summary, scoped to just this plan's slots in schedule mode
  // (a medication's OTHER plans' doses would otherwise show up mixed in
  // here), aggregated across all its slots in identity mode (a single
  // useful-at-a-glance summary, since medSheet itself has no single "the"
  // schedule to point at anymore).
  function renderMedListRow(m, { showPlanTag, mode = 'identity', planId } = {}) {
    const relevantSlots = mode === 'schedule'
      ? scheduleSlots.filter(sl => sl.medicationId === m.id && sl.medicationPlanId === planId)
      : scheduleSlots.filter(sl => sl.medicationId === m.id);
    const scheduleSummary = relevantSlots.length
      ? relevantSlots.map(sl => `${mdSlotDaysLabel(sl)} ${String(sl.hour).padStart(2, '0')}:00 · ${mdFmtQty(sl.doseQty, m.unitLabel)}`).join('; ')
      : 'No schedule yet';
    const memberPlanNames = showPlanTag
      ? medicationPlanItems.filter(it => it.medicationId === m.id).map(it => medicationPlans.find(p => p.id === it.medicationPlanId)?.name).filter(Boolean)
      : [];
    return (
      <button key={m.id} onClick={() => mode === 'schedule' ? openSchedMed(m, planId) : openMedSheet(m)} style={{ ...mdQuickRowInner, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={mdEntryName}>{m.name}</span>
          {m.category && <Pill gold>{mdCategoryLabel(m.category)}</Pill>}
        </div>
        <div style={mdEntryMeta}>
          {showPlanTag && `${memberPlanNames.length ? memberPlanNames.join(', ') : 'Not in a plan'} · `}{scheduleSummary}
        </div>
      </button>
    );
  }

  const [planNameDraft, setPlanNameDraft] = useStateMd(null); // { id: null|id, name }
  const planNameInitialSnap = useRefMd(null);
  function openPlanNameDraft(draft) {
    planNameInitialSnap.current = draft.name;
    setPlanNameDraft(draft);
  }
  // Same backdrop-dismiss protection as requestCloseMedSheet/
  // requestCloseSlotDraft: a typed plan name (new or renamed) shouldn't
  // vanish silently on a stray backdrop tap either.
  async function requestClosePlanNameDraft() {
    if (planNameDraft && planNameDraft.name !== planNameInitialSnap.current
      && !await confirm("Your changes won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    setPlanNameDraft(null);
  }
  function createPlan(name) {
    const id = LB.uid();
    const nowISO = new Date().toISOString();
    const asTemplate = isCoach && planSubTab === 'templates';
    setStore(s => ({
      ...s,
      // Defaults to INACTIVE (unlike most default states in this app): a new
      // plan is often just being staged for later (a coach prepping a cycle
      // ahead of its start date), not meant to fire doses the moment it's
      // created. The user flips it on via the plan-detail view's own toggle
      // once it's actually ready to run.
      medicationPlans: [{ id, name: (name || '').trim() || 'Medications', archived: false, isTemplate: asTemplate, coachId: null, active: false, createdAt: nowISO, updatedAt: nowISO }, ...(s.medicationPlans || [])],
    }));
    setViewedPlanId(id);
  }
  function renamePlan(id, name) {
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === id ? { ...p, name: (name || '').trim() || p.name, updatedAt: new Date().toISOString() } : p) }));
  }
  // Only an active plan's schedule slots fire (LB.dsSlotAppliesOn); several
  // plans can be active at once, no single active pointer (see the header
  // comment). A paused plan stays fully visible/editable, this never
  // touches its medications or their memberships/slots, purely a switch.
  function togglePlanActive(plan) {
    const goingInactive = plan.active;
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === plan.id ? { ...p, active: !p.active, updatedAt: new Date().toISOString() } : p) }));
    // Only pausing needs reconciliation: re-activating has nothing stray to
    // remove, and the effect that calls mdAutoFillToday is keyed on
    // store.medicationPlans, so it re-materializes today's slots on its own
    // the moment this plan goes active again.
    if (goingInactive) {
      const slotIds = new Set((store.medicationScheduleSlots || []).filter(sl => sl.medicationPlanId === plan.id).map(sl => sl.id));
      mdReconcilePlannedLogs(setStore, today, slotIds);
    }
  }
  async function deletePlan(plan) {
    // Only this plan's own membership rows and schedule slots go: a
    // medication itself, its OTHER plans' memberships/schedules, and its
    // log history are all untouched, same non-destructive reasoning as
    // removeMedicationFromPlan (this is that same operation, just for
    // every medication currently in the plan at once).
    if (!await confirm(`Delete "${plan.name}"? Its medications stay in your Medications list (and any other plans they're in), just this plan's own schedule for them goes.`, { title: 'Delete plan', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    const slotIds = new Set((store.medicationScheduleSlots || []).filter(sl => sl.medicationPlanId === plan.id).map(sl => sl.id));
    setStore(s => ({
      ...s,
      medicationPlans: (s.medicationPlans || []).filter(p => p.id !== plan.id),
      medicationPlanItems: (s.medicationPlanItems || []).filter(it => it.medicationPlanId !== plan.id),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.medicationPlanId !== plan.id),
    }));
    mdReconcilePlannedLogs(setStore, today, slotIds);
    setViewedPlanId(null);
  }
  function toggleTemplate(plan) {
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === plan.id ? { ...p, isTemplate: !p.isTemplate, updatedAt: new Date().toISOString() } : p) }));
  }

  // Medication identity + inventory edit sheet. draft.id === null means
  // "creating a new medication" (see the header comment: identity only,
  // strictly no plan/schedule fields here); a saved medication's plan
  // memberships are listed in medSheetMemberships below, each individually
  // removable, never a single medicationPlanId.
  const [medSheet, setMedSheet] = useStateMd(null);
  const medSheetInitialSnap = useRefMd(null);
  // Identity fields only: medSheet never touches stock (that's the
  // Inventory tab's own stockSheet, see openStockSheet below) or schedule
  // while creating (see the Schedule section's medSheet.id gate further
  // down; an existing medication's schedule already writes straight to the
  // store the moment you add/edit/delete a time, see saveSlotDraft/
  // deleteSlot, so it was never part of "did the user change something"
  // here to begin with).
  function snapMedSheet(d) {
    return JSON.stringify({
      name: d.name, brand: d.brand, category: d.category, unitLabel: d.unitLabel, packageSizeStr: d.packageSizeStr,
      excludeFromPillbox: d.excludeFromPillbox, trackStock: d.trackStock,
    });
  }
  // Every plan this medication currently belongs to, for medSheet's own
  // membership list below (a medication can be in several plans at once,
  // see the header comment).
  const medSheetMemberships = useMemoMd(() => {
    if (!medSheet?.id) return [];
    const planName = (it) => medicationPlans.find(p => p.id === it.medicationPlanId)?.name || '';
    return medicationPlanItems.filter(it => it.medicationId === medSheet.id).sort((a, b) => planName(a).localeCompare(planName(b)));
  }, [medicationPlanItems, medSheet?.id, medicationPlans]);
  // A medication is only ever created with zero plan memberships: creating
  // one lives exclusively in the Inventory tab's Medications sub-tab, a
  // plan's own "Add medication" only ever attaches an existing one (see
  // confirmAddToPlan), never creates a fresh one.
  function openMedSheet(med) {
    const next = med ? {
      id: med.id, name: med.name, brand: med.brand || '', category: med.category || '',
      unitLabel: med.unitLabel || 'pills', packageSizeStr: med.packageSize != null ? String(med.packageSize) : '',
      excludeFromPillbox: !!med.excludeFromPillbox, trackStock: !!med.trackStock,
    } : {
      // trackStock off by default for a new medication too (migration
      // 0236): most medications (vitamins, anything nobody physically
      // counts) are never meant to show up in the Stock sub-view at all,
      // tracking is opt-in per medication, not opt-out.
      id: null, name: '', brand: '', category: '', unitLabel: 'pills', packageSizeStr: '',
      excludeFromPillbox: false, trackStock: false,
    };
    medSheetInitialSnap.current = snapMedSheet(next);
    setMedSheet(next);
  }
  function closeMedSheet() { setMedSheet(null); }
  // Backdrop tap used to drop the whole in-progress medication (name,
  // brand, category, unit, package size) silently, same trap
  // screens-food.jsx's own meal-slot draft had (see requestCloseDraft there).
  async function requestCloseMedSheet() {
    if (medSheet && snapMedSheet(medSheet) !== medSheetInitialSnap.current
      && !await confirm("Your changes won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    closeMedSheet();
  }
  function saveMedSheet() {
    if (!medSheet || !medSheet.name.trim()) return;
    const packageSize = mdNum(medSheet.packageSizeStr);
    const nowISO = new Date().toISOString();
    if (medSheet.id) {
      // lowStockThreshold/excludeFromLowStock are deliberately absent from
      // this patch: they moved to stockSheet (Inventory > Stock), the
      // spread below leaves whatever's already stored untouched.
      setStore(s => ({
        ...s,
        medications: (s.medications || []).map(m => m.id !== medSheet.id ? m : {
          ...m, name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
          category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills',
          packageSize, excludeFromPillbox: !!medSheet.excludeFromPillbox, trackStock: !!medSheet.trackStock, updatedAt: nowISO,
        }),
      }));
    } else {
      const newMed = {
        id: LB.uid(), name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
        category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills', packageSize,
        lowStockThreshold: null, excludeFromLowStock: false,
        stockBaseline: null, stockSetAt: null, archived: false, excludeFromPillbox: !!medSheet.excludeFromPillbox,
        trackStock: !!medSheet.trackStock,
        createdAt: nowISO, updatedAt: nowISO,
      };
      setStore(s => ({ ...s, medications: [...(s.medications || []), newMed] }));
    }
    closeMedSheet();
  }
  async function deleteMedication(med) {
    if (!await confirm(`Delete "${med.name}"? Its schedule goes with it, past log entries stay (as history).`, { title: 'Delete medication', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({
      ...s,
      medications: (s.medications || []).filter(m => m.id !== med.id),
      medicationPlanItems: (s.medicationPlanItems || []).filter(it => it.medicationId !== med.id),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.medicationId !== med.id),
    }));
    closeMedSheet();
  }
  // Removes ONE plan membership (a medication can be in several, see the
  // header comment): deletes that membership row and this plan's own
  // schedule slots for this medication only, other plans' memberships/
  // schedules for the same medication and all log history stay untouched.
  // No longer "nothing is actually lost" like the old single-plan version:
  // a plan-specific schedule genuinely goes with it now, so this needs a
  // confirm like Delete does. Doesn't close medSheet itself: it now shows a
  // list of memberships, removing one should leave the sheet open on the
  // rest. Returns true/false (not just implicit undefined either way) so
  // schedMed's own "Remove from plan" button (schedMed has nothing left to
  // show once its medication leaves the plan being viewed) can tell an
  // actual removal apart from the user cancelling the confirm.
  async function removeMedicationFromPlan(med, planId) {
    const planName = medicationPlans.find(p => p.id === planId)?.name || 'this plan';
    if (!await confirm(`Remove "${med.name}" from "${planName}"? Its schedule in this plan goes with it; the medication itself, any other plans it's in, and its log history all stay.`, { title: 'Remove from plan', ok: 'Remove', cancel: 'Cancel', danger: true })) return false;
    const slotIds = new Set(scheduleSlots.filter(sl => sl.medicationId === med.id && sl.medicationPlanId === planId).map(sl => sl.id));
    setStore(s => ({
      ...s,
      medicationPlanItems: (s.medicationPlanItems || []).filter(it => !(it.medicationId === med.id && it.medicationPlanId === planId)),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => !(sl.medicationId === med.id && sl.medicationPlanId === planId)),
    }));
    mdReconcilePlannedLogs(setStore, today, slotIds);
    return true;
  }

  // Medication currently open for schedule editing only (name/unitLabel as
  // read-only labels, see the schedMed Sheet further down): opened from a
  // plan's own detail view via renderMedListRow's mode option, entirely
  // separate from medSheet's identity editing above (see the header
  // comment's split). Not a draft needing a backdrop-dismiss guard like
  // medSheet/slotDraft/planNameDraft: it's just a "whose schedule am I
  // looking at" pointer, saveSlotDraft/deleteSlot below write straight to
  // the store per slot, there's nothing unsaved to lose on a stray tap.
  const [schedMed, setSchedMed] = useStateMd(null); // { id, name, unitLabel, medicationPlanId } | null
  function openSchedMed(med, planId) { setSchedMed({ id: med.id, name: med.name, unitLabel: med.unitLabel, medicationPlanId: planId }); }
  function closeSchedMed() { setSchedMed(null); }
  // Schedule slots for the medication currently open in schedMed, scoped to
  // THIS plan only: a slot is scoped to one (medication, plan) pair, so a
  // medication's slots under a different plan must never show up here.
  const schedMedSlots = useMemoMd(
    () => schedMed?.id ? scheduleSlots.filter(sl => sl.medicationId === schedMed.id && sl.medicationPlanId === schedMed.medicationPlanId) : [],
    [scheduleSlots, schedMed?.id, schedMed?.medicationPlanId],
  );
  // Move this medication, and this plan's whole schedule for it, into a
  // different plan of the same bucket (mine vs. client template): e.g. "all
  // my peptides ended up under Gear, I want them in their own Peptides plan
  // instead" without re-typing every "Add time" slot by hand. Reassigns the
  // existing membership row's medicationPlanId in place (still unique per
  // (medication, plan) since the target list already excludes plans this
  // medication is a member of) and re-scopes every one of this plan's own
  // slots for it the same way, so the schedule itself moves wholesale.
  const [movePlanOpen, setMovePlanOpen] = useStateMd(false);
  const moveTargetPlans = useMemoMd(() => {
    if (!schedMed) return [];
    const currentPlan = medicationPlans.find(p => p.id === schedMed.medicationPlanId);
    const alreadyIn = new Set(medicationPlanItems.filter(it => it.medicationId === schedMed.id).map(it => it.medicationPlanId));
    return medicationPlans
      .filter(p => !p.archived && p.id !== schedMed.medicationPlanId && !alreadyIn.has(p.id) && !!p.isTemplate === !!currentPlan?.isTemplate)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [medicationPlans, medicationPlanItems, schedMed]);
  function moveMedicationToPlan(targetPlanId) {
    if (!schedMed) return;
    const sourcePlanId = schedMed.medicationPlanId;
    setStore(s => ({
      ...s,
      medicationPlanItems: (s.medicationPlanItems || []).map(it =>
        (it.medicationId === schedMed.id && it.medicationPlanId === sourcePlanId) ? { ...it, medicationPlanId: targetPlanId } : it
      ),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).map(sl =>
        (sl.medicationId === schedMed.id && sl.medicationPlanId === sourcePlanId) ? { ...sl, medicationPlanId: targetPlanId, updatedAt: new Date().toISOString() } : sl
      ),
    }));
    setMovePlanOpen(false);
    // No longer part of the plan being viewed, nothing left to show here.
    closeSchedMed();
  }
  const [slotDraft, setSlotDraft] = useStateMd(null); // { id: null|id, mode: 'weekdays'|'interval', weekdays, intervalDaysNum, hour, doseQtyStr, phaseOpen, startDate, endDate }
  const slotDraftInitialSnap = useRefMd(null);
  function snapSlotDraft(d) {
    return JSON.stringify({ mode: d.mode, weekdays: d.weekdays, intervalDaysNum: d.intervalDaysNum, hour: d.hour, doseQtyStr: d.doseQtyStr, phaseOpen: d.phaseOpen, startDate: d.startDate, endDate: d.endDate });
  }
  function openSlotDraft(slot) {
    const next = slot ? {
      id: slot.id, mode: slot.intervalDays > 0 ? 'interval' : 'weekdays',
      weekdays: [...(slot.weekdays || [])], intervalDaysNum: slot.intervalDays > 0 ? slot.intervalDays : 2,
      hour: slot.hour, doseQtyStr: String(slot.doseQty ?? ''),
      phaseOpen: !!(slot.startDate || slot.endDate), startDate: slot.startDate || '', endDate: slot.endDate || '',
    } : {
      // Starts with NO days selected (was all 7): a blank slate reads more
      // honestly as "pick what you actually mean" than a default that
      // happens to already be right only for an every-day dose.
      // selectAllWeekdays below is the one-tap shortcut for that common case.
      // 2 is intervalDaysNum's own default once interval mode gets picked,
      // matching the most common real case (a compound dosed every other day).
      id: null, mode: 'weekdays', weekdays: [], intervalDaysNum: 2, hour: 8, doseQtyStr: '',
      phaseOpen: false, startDate: '', endDate: '',
    };
    slotDraftInitialSnap.current = snapSlotDraft(next);
    setSlotDraft(next);
  }
  // Same backdrop-dismiss protection as requestCloseMedSheet above, this
  // sheet's own risk if anything is higher: weekdays + hour + dose + an
  // optional phase range is more to retype than any single medSheet field.
  async function requestCloseSlotDraft() {
    if (slotDraft && snapSlotDraft(slotDraft) !== slotDraftInitialSnap.current
      && !await confirm("Your changes won't be saved.", { title: 'Discard changes?', ok: 'Discard', cancel: 'Keep editing', danger: true })) return;
    setSlotDraft(null);
  }
  function saveSlotDraft() {
    if (!schedMed?.id || !schedMed.medicationPlanId || !slotDraft) return;
    const isInterval = slotDraft.mode === 'interval';
    // Interval mode has nothing equivalent to "no weekdays picked" to guard
    // on, startDate is its own required field instead (it's the count-from
    // anchor, not an optional phase bound here, see LB.dsSlotAppliesOn).
    if (isInterval ? !slotDraft.startDate : !slotDraft.weekdays.length) return;
    const doseQty = mdNum(slotDraft.doseQtyStr);
    if (!(doseQty > 0)) return;
    // A reversed range (From after To) would otherwise save silently and
    // just never fire: LB.dsSlotAppliesOn rejects every date once startDate is
    // after endDate, so the slot would sit there looking scheduled but dead.
    // Only meaningful once both ends are actually set, an open-ended range
    // (only one of the two) is fine as-is.
    if (slotDraft.startDate && slotDraft.endDate && slotDraft.startDate > slotDraft.endDate) return;
    const nowISO = new Date().toISOString();
    // Gated on the fields' own values, NOT on phaseOpen: phaseOpen only
    // controls whether the date-range section is visually expanded in
    // weekday mode (interval mode always shows it, startDate isn't optional
    // there). Collapsing it to declutter the sheet must not silently wipe a
    // staged cycle's dates, only actually clearing the inputs should.
    const startDate = slotDraft.startDate || null;
    const endDate = slotDraft.endDate || null;
    // The two modes are mutually exclusive per slot: switching a slot from
    // one to the other on edit must clear the other mode's field rather than
    // leave a stale value sitting there unused, LB.dsSlotAppliesOn only ever
    // reads intervalDays first, but a stale weekdays/intervalDays value would
    // still be misleading to anyone inspecting the row directly.
    const weekdays = isInterval ? [] : slotDraft.weekdays;
    const intervalDays = isInterval ? slotDraft.intervalDaysNum : null;
    if (slotDraft.id) {
      setStore(s => ({
        ...s,
        medicationScheduleSlots: (s.medicationScheduleSlots || []).map(sl => sl.id !== slotDraft.id ? sl : {
          ...sl, weekdays, hour: slotDraft.hour, doseQty, intervalDays,
          startDate, endDate, updatedAt: nowISO,
        }),
      }));
    } else {
      const newSlot = {
        id: LB.uid(), medicationId: schedMed.id, medicationPlanId: schedMed.medicationPlanId,
        weekdays, hour: slotDraft.hour, intervalDays,
        doseQty, startDate, endDate, createdAt: nowISO, updatedAt: nowISO,
      };
      setStore(s => ({ ...s, medicationScheduleSlots: [...(s.medicationScheduleSlots || []), newSlot] }));
    }
    setSlotDraft(null);
  }
  // Same confirm guard as deletePlan/deleteMedication/deleteLogEntry above:
  // this was the one destructive action in the file with no confirmation at
  // all, so a stray tap on the row's small "x" button could wipe a dosing
  // time with no way back.
  async function deleteSlot(slot) {
    if (!await confirm('Delete this dosing time?', { title: 'Delete time', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({ ...s, medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.id !== slot.id) }));
    mdReconcilePlannedLogs(setStore, today, new Set([slot.id]));
  }
  function toggleWeekday(wd) {
    setSlotDraft(d => {
      const has = d.weekdays.includes(wd);
      return { ...d, weekdays: has ? d.weekdays.filter(w => w !== wd) : [...d.weekdays, wd].sort((a, b) => a - b) };
    });
  }
  function selectAllWeekdays() {
    setSlotDraft(d => ({ ...d, weekdays: [...MD_WEEKDAYS_EVERY_DAY] }));
  }

  // Coach: push a template plan (+ its medications + their schedule slots) to a client.
  const [pushPlan, setPushPlan] = useStateMd(null);
  const [pushTarget, setPushTarget] = useStateMd(null);
  const [pushBusy, setPushBusy] = useStateMd(false);
  const [pushDone, setPushDone] = useStateMd(null);
  const [coachMenuOpen, setCoachMenuOpen] = useStateMd(false);
  async function doPush() {
    if (!pushPlan || !pushTarget) return;
    setPushBusy(true);
    try {
      const planItemsForPush = medicationPlanItems.filter(it => it.medicationPlanId === pushPlan.id);
      const medIds = new Set(planItemsForPush.map(it => it.medicationId));
      const planMeds = medications.filter(m => medIds.has(m.id));
      await LB.pushMedicationPlanToClient({
        plan: pushPlan, medications: planMeds, planItems: planItemsForPush,
        scheduleSlots: scheduleSlots.filter(sl => sl.medicationPlanId === pushPlan.id),
        coachUserId: userId, coachingId: pushTarget.id, clientId: pushTarget.clientId,
      });
      setPushTarget(null); setPushPlan(null);
      setPushDone({ clientName: pushTarget.clientName, planName: pushPlan.name });
    } catch (e) {
      await confirm(e?.message || 'Push failed. Please try again.', { title: 'Push failed', ok: 'OK', cancel: null });
    } finally {
      setPushBusy(false);
    }
  }

  // ─────────────────────────── Inventory tab ───────────────────────────
  // Every non-archived medication, tracked or not: unlike the Shopping
  // List's own Inventory tab, there's no separate staple/frequency filter in
  // front of this list, the medication catalog IS the inventory here.
  // Its own Inventory/Medications sub-switch mirrors that same Shopping List
  // screen's Shopping List/Inventory one: Inventory here is the stock/low-
  // stock view (renderMedRow), Medications is the create/edit/delete surface
  // for the medication itself (renderMedListRow), independent of any plan.
  const [invSubTab, setInvSubTab] = useStateMd('medications'); // 'inventory' | 'medications'
  // activeMedications is already alphabetically sorted at its own
  // declaration, nothing left to do here beyond the name/intent this
  // variable carries in the rest of this tab's code.
  const inventoryList = activeMedications;
  // store.medicationLogs is boot-windowed (FOOD_HISTORY_WINDOW_DAYS), which
  // understates consumption, and so overstates stock, for a baseline set
  // further back than that (a bulk supply bought a few times a year). Lazily
  // fetched in full from the DB whenever the Timeline or Stock tab is
  // actually open (both read effectiveStockById below, Timeline for its own
  // Running Low banner), rather than widening the boot window itself, which
  // every screen would then pay for on every load. Reset to null on leaving
  // both tabs so the next visit always refetches current data, not a stale
  // snapshot.
  const [stockBackfill, setStockBackfill] = useStateMd(null);
  // Surfaced below near renderMedRow's own stock numbers (and the Timeline
  // banner): a silent, console-only failure here left stockBackfill null
  // forever with no visible sign the numbers on screen are the understated
  // boot-windowed ones, not the real backfilled totals. Reset at the top of
  // every run, not just on the failure path, so a fresh attempt (e.g.
  // reopening one of the two tabs) always clears a stale warning from an
  // earlier try.
  const [stockBackfillError, setStockBackfillError] = useStateMd(false);
  useEffectMd(() => {
    setStockBackfillError(false);
    if (screenTab !== 'inventory' && screenTab !== 'timeline') { setStockBackfill(null); return; }
    const oldestBaseline = activeMedications.reduce((min, m) => (m.stockSetAt && (!min || m.stockSetAt < min)) ? m.stockSetAt : min, null);
    if (!oldestBaseline) return;
    let cancelled = false;
    LB.fetchMedicationLogsSince(userId, oldestBaseline.slice(0, 10))
      .then(rows => { if (!cancelled) setStockBackfill(rows); })
      .catch(err => {
        console.error('medication stock backfill fetch failed:', err);
        if (!cancelled) setStockBackfillError(true);
      });
    return () => { cancelled = true; };
  }, [screenTab, activeMedications, userId]);
  const logsForStock = stockBackfill || medicationLogs;
  // Computed once per medication per render and reused everywhere below
  // (lowStockList, mainInventoryList, renderMedRow, the stock sheet),
  // instead of every one of those independently re-running
  // mdEffectiveStock's own full scan over medicationLogs, mirrors the Food
  // Shopping List's own compute-once-per-item pattern (fdApplyShoppingPrefs).
  const effectiveStockById = useMemoMd(() => {
    const map = new Map();
    activeMedications.forEach(m => map.set(m.id, mdEffectiveStock(m, logsForStock, today)));
    return map;
  }, [activeMedications, logsForStock, today]);

  // Search + filter sheet shared by BOTH Inventory sub-tabs (Medications and
  // Stock are just two different lenses on the exact same underlying
  // inventoryList), mirrors the Exercises library's own search+filter row
  // (screens-lib.jsx: a Field/TextInput at flex:1 next to a Filter button
  // with a GoldSectionLabel sheet, gold active-count badge). Category is
  // multi-select (an array, like that screen's own MUSCLE GROUP filter);
  // Plan is a nullable single choice (like that screen's own PLAN filter:
  // tapping the same pill again clears it back to "no filter"). Search is
  // free text, matched against name/brand, and deliberately left out of
  // the active-count badge, same as Exercises' own q not counting toward
  // its activeCount either.
  const [invSearch, setInvSearch] = useStateMd('');
  const [stockFilterCategories, setStockFilterCategories] = useStateMd([]); // MED_CATEGORIES ids
  const [stockFilterInPlan, setStockFilterInPlan] = useStateMd(null); // 'in' | 'out' | null
  const [stockFiltersOpen, setStockFiltersOpen] = useStateMd(false);
  const toggleStockFilterCategory = (c) => setStockFilterCategories(cats => cats.includes(c) ? cats.filter(x => x !== c) : [...cats, c]);
  const toggleStockFilterInPlan = (v) => setStockFilterInPlan(cur => cur === v ? null : v);
  const stockFilterActiveCount = stockFilterCategories.length + (stockFilterInPlan !== null ? 1 : 0);
  function clearStockFilters() {
    setStockFilterCategories([]);
    setStockFilterInPlan(null);
  }
  // Search, Category and Plan apply everywhere this feeds into: Running Low,
  // the Stock tab's own list, and the Medications tab's own list, all three
  // are genuine "which medications" questions no matter which tab is asking.
  const filteredInventoryBase = useMemoMd(() => inventoryList.filter(m => {
    const ql = invSearch.trim().toUpperCase();
    const matchSearch = !ql || m.name.toUpperCase().includes(ql) || (m.brand || '').toUpperCase().includes(ql);
    const matchCategory = stockFilterCategories.length === 0 || stockFilterCategories.includes(m.category);
    const matchPlan = stockFilterInPlan === null || (stockFilterInPlan === 'in' ? mdHasPlan(m, medicationPlanItems) : !mdHasPlan(m, medicationPlanItems));
    return matchSearch && matchCategory && matchPlan;
  }), [inventoryList, invSearch, stockFilterCategories, stockFilterInPlan, medicationPlanItems]);

  const lowStockList = useMemoMd(
    () => filteredInventoryBase.filter(m => mdIsLowStock(m, effectiveStockById.get(m.id))),
    [filteredInventoryBase, effectiveStockById],
  );
  // Same computation, off inventoryList directly instead of
  // filteredInventoryBase: the Inventory tab's own search/category/plan
  // filters have nothing to do with whether the Timeline's own banner
  // should show, a medication doesn't stop running low just because
  // someone's search box (on a completely different tab) doesn't match it
  // right now. lowStockList above stays as the Inventory tab's own
  // filtered view, this is the "is anything genuinely low, full stop" one.
  const allLowStockList = useMemoMd(
    () => inventoryList.filter(m => mdIsLowStock(m, effectiveStockById.get(m.id))),
    [inventoryList, effectiveStockById],
  );
  const [lowStockAcks, setLowStockAcks] = useStateMd(mdReadLowStockAcks);
  const freshLowStock = useMemoMd(
    () => lowStockList.filter(m => lowStockAcks[m.id] !== m.stockSetAt),
    [lowStockList, lowStockAcks],
  );
  // Timeline gets its own "fresh" derivation off the unfiltered list, but
  // shares lowStockAcks with the Inventory tab's banner: dismissing either
  // one is the same underlying "I've seen this" fact, not a per-tab one.
  const freshAllLowStock = useMemoMd(
    () => allLowStockList.filter(m => lowStockAcks[m.id] !== m.stockSetAt),
    [allLowStockList, lowStockAcks],
  );
  // Takes the list to ack explicitly (freshLowStock from the Inventory
  // banner, freshAllLowStock from the Timeline one) rather than always
  // reading freshLowStock itself, so each banner only marks the items it's
  // actually showing right now, not the other one's (usually-larger,
  // unfiltered) set.
  function dismissLowStockBanner(list) {
    const next = { ...lowStockAcks };
    list.forEach(m => { next[m.id] = m.stockSetAt; });
    setLowStockAcks(next);
    mdWriteLowStockAcks(next);
  }

  // trackStock off (migration 0235) drops a medication from this list
  // entirely, not even as "Not tracked": the Medications sub-tab
  // (filteredInventoryBase directly, no separate list of its own needed
  // now that the old Tracked/Not-tracked filter is gone) stays unaffected
  // on purpose, a medication opted out of Stock display should still be
  // findable/editable there.
  const mainInventoryList = useMemoMd(
    () => filteredInventoryBase.filter(m => m.trackStock && !mdIsLowStock(m, effectiveStockById.get(m.id))),
    [filteredInventoryBase, effectiveStockById],
  );

  // Tapping a row here only ever updates stock, never identity/category/
  // schedule: those live behind the Schedule tab's own medication sheet, on
  // purpose, so Inventory stays a single-purpose "how much is left" screen.
  // packageSize rides along read-only (this sheet never edits it, medSheet
  // does) purely to decide which input mode the JSX below shows. Warn when
  // below / Cycle only live here too, not in medSheet: this is a Stock-only
  // sheet, reachable only for a trackStock medication (its row wouldn't
  // otherwise show at all, see mainInventoryList/lowStockList above), so
  // there's no separate on/off gate needed here the way medSheet needed one.
  const [stockSheet, setStockSheet] = useStateMd(null); // { id, name, unitLabel, packageSize, stockStr, stockPacksStr, stockExtraStr, lowStockThresholdStr, excludeFromLowStock } | null
  function openStockSheet(med) {
    setStockSheet({
      id: med.id, name: med.name, unitLabel: med.unitLabel || 'pills', packageSize: med.packageSize ?? null,
      stockStr: '', stockPacksStr: '', stockExtraStr: '',
      lowStockThresholdStr: med.lowStockThreshold != null ? String(med.lowStockThreshold) : '',
      excludeFromLowStock: !!med.excludeFromLowStock,
    });
  }
  // Same pack-aware resolution as screens-food.jsx's saveEdit: with a
  // package size known, packs+extra wins if either was touched (e.g. "10
  // packs + 18 IU" for a 36 IU/pack HGH kit = 378 IU), otherwise falls back
  // to the plain single-quantity field. null means nothing meaningful has
  // been typed at all (leave-unchanged on save). Shared by saveStockSheet
  // below and the live total preview in the JSX further down, so what's
  // shown while typing and what actually gets saved can never drift apart.
  function mdStockSheetTotal(sheet) {
    if (!sheet) return null;
    if (sheet.packageSize > 0 && (sheet.stockPacksStr.trim() || sheet.stockExtraStr.trim())) {
      return (mdNum(sheet.stockPacksStr) || 0) * sheet.packageSize + (mdNum(sheet.stockExtraStr) || 0);
    }
    return sheet.stockStr.trim() ? mdNum(sheet.stockStr) : null;
  }
  function saveStockSheet() {
    if (!stockSheet) return;
    const stockTyped = mdStockSheetTotal(stockSheet);
    // lowStockThreshold/excludeFromLowStock always commit, same "always
    // overwrite with whatever's in the field" semantics medSheet used for
    // these two: they're settings being actively edited, not a "log a new
    // reading" action like the stock quantity itself, which only writes
    // when something was actually typed (see mdStockSheetTotal's own null
    // case), leaving stock untouched otherwise.
    const lowStockThreshold = mdNum(stockSheet.lowStockThresholdStr);
    const nowISO = new Date().toISOString();
    setStore(s => ({
      ...s,
      medications: (s.medications || []).map(m => m.id !== stockSheet.id ? m : {
        ...m,
        ...(stockTyped != null ? { stockBaseline: stockTyped, stockSetAt: nowISO } : {}),
        lowStockThreshold, excludeFromLowStock: !!stockSheet.excludeFromLowStock,
        updatedAt: nowISO,
      }),
    }));
    setStockSheet(null);
  }
  // Resets stockBaseline/stockSetAt to null, i.e. genuinely untracked again
  // (mdEffectiveStock returns null, mdIsLowStock can never fire), not just a
  // muted warning: for a compound being wound down on purpose with no
  // intent to reorder, there's nothing left worth tracking, the exact
  // remaining count stops mattering the moment reordering is off the table.
  // No new column needed, this only ever touches the two fields normal
  // restocking already writes. Re-tracking later is just typing a new count.
  async function clearStockSheet() {
    if (!stockSheet) return;
    if (!await confirm("Stops tracking stock for this medication, including the Running Low warning. You can start again anytime by entering a new count.", { title: 'Clear inventory?', ok: 'Clear', cancel: 'Cancel', danger: true })) return;
    const nowISO = new Date().toISOString();
    setStore(s => ({
      ...s,
      medications: (s.medications || []).map(m => m.id !== stockSheet.id ? m : { ...m, stockBaseline: null, stockSetAt: null, updatedAt: nowISO }),
    }));
    setStockSheet(null);
  }

  // Stock is the headline here, package size the quiet caption, same
  // prominence swap as the Food Shopping List's own Inventory row
  // (fdBuildInventoryList/renderShoppingRow, screens-food.jsx): without a
  // real buy-quantity estimate to show, the number worth a glance is how
  // much is actually left, not the static per-pack fact.
  function renderMedRow(med) {
    const effectiveStock = effectiveStockById.get(med.id);
    const low = mdIsLowStock(med, effectiveStock);
    return (
      <button key={med.id} onClick={() => openStockSheet(med)} style={{ ...mdQuickRowInner, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ ...mdEntryName, minWidth: 0 }}>{med.name}</div>
            {med.category && <Pill gold>{mdCategoryLabel(med.category)}</Pill>}
            {/* mdIsLowStock always returns false for a Cycle-only medication
                (excludeFromLowStock), so it never lands in the Running Low
                section no matter how low it actually gets, this is the only
                place that still says so. Bell-slash, not a rotate/cycle
                icon: a circular arrow reads as "recurring", the opposite
                of what "Cycle only" actually means (a one-off supply,
                explicitly not being reordered). Bell-slash says "muted
                warning" directly, independent of the (misleading) name. */}
            {med.excludeFromLowStock && <i className="fa-solid fa-bell-slash" title="Cycle only, no Running Low warning" style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }} />}
          </div>
          {med.packageSize > 0
            ? <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{mdFmtQty(med.packageSize, med.unitLabel)}/pack</div>
            : (med.brand ? <div style={mdEntryMeta}>{med.brand}</div> : null)}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {effectiveStock != null
            ? (<>
                <div className="num" style={{ fontSize: 13, color: low ? 'var(--warn)' : UI.ink }}>{mdFmtQty(effectiveStock, med.unitLabel)}</div>
                <div style={{ fontSize: 9, color: low ? 'var(--warn)' : UI.inkFaint }}>{low ? 'left' : 'in stock'}</div>
              </>)
            : <div style={mdEntryMeta}>Not tracked</div>}
        </div>
      </button>
    );
  }

  // Shared search box + "Filter" trigger, used by both Inventory sub-tabs
  // (see the filter state's own comment above): same search, same sheet,
  // same active-count badge, wherever it's rendered from. Layout mirrors the
  // Exercises library's own search+filter row (screens-lib.jsx) exactly: a
  // flex:1 Field/TextInput next to the Filter button, not stacked.
  function renderSearchAndFilterRow() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="">
            <TextInput value={invSearch} onChange={setInvSearch} placeholder="Search…" />
          </Field>
        </div>
        <button onClick={() => setStockFiltersOpen(true)} style={{
          flexShrink: 0, background: stockFilterActiveCount > 0 ? UI.goldFaint : 'transparent',
          border: `1px solid ${stockFilterActiveCount > 0 ? UI.goldSoft : UI.hairStrong}`,
          borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
          color: stockFilterActiveCount > 0 ? UI.gold : UI.inkSoft,
          fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 5, WebkitTapHighlightColor: 'transparent',
        }}>
          Filter{stockFilterActiveCount > 0 && <span style={{ background: UI.gold, color: 'var(--accent-ink)', textShadow: 'none', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700 }}>{stockFilterActiveCount}</span>}
        </button>
      </div>
    );
  }

  if (!store) return null;
  return (
    <Screen>
      <TopBar title="Medications" onBack={() => go({ name: 'home' })} right={
        screenTab === 'timeline' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setWeeklyPrepOpen(true)} aria-label="Weekly Prep" style={mdTopAddBtn}>
              <i className="fa-solid fa-calendar-week" style={{ fontSize: 14 }} />
            </button>
            <button onClick={() => openLogSheet()} aria-label="Log a dose" style={mdTopAddBtn} disabled={!activeMedications.length}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          </div>
        )
      } />
      {confirmEl}
      <SubTabBar tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'schedule', label: 'Schedule' }, { id: 'inventory', label: 'Inventory' }]} active={screenTab} onChange={setScreenTab} />

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {screenTab === 'timeline' && (
          <>
            {/* Same staleness indicator as the Inventory tab's own (see
                stockBackfillError's comment above): the banner right below
                reads off the same backfilled numbers, a failed fetch here
                means it's judging "running low" off the understated
                boot-windowed log instead. */}
            {stockBackfillError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="fa-solid fa-triangle-exclamation" title="Stock estimate may be outdated. Retry by reopening this tab." style={{ fontSize: 10, color: UI.inkFaint }} />
                <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>Stock estimate may be outdated</span>
              </div>
            )}
            {/* Same dismissible warning as the Inventory tab's own (see
                freshAllLowStock's comment above), surfaced here too since
                Timeline is the tab people actually open day to day, not
                everyone remembers to go check Inventory on its own. The
                text itself is a separate sibling button that jumps straight
                to Inventory > Stock, not the whole row: nesting the Dismiss
                button inside a row-wide button breaks the layout, same trap
                renderShoppingRow's own checkbox comment warns about in
                screens-food.jsx. */}
            {freshAllLowStock.length > 0 && (
              <div style={{ background: 'rgba(var(--warn-rgb),0.14)', border: '1px solid rgba(var(--warn-rgb),0.45)', borderRadius: 6, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => { setScreenTab('inventory'); setInvSubTab('inventory'); }} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                  <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 15, color: 'var(--warn)', flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                    {freshAllLowStock.length === 1 ? `${freshAllLowStock[0].name} is running low.` : `${freshAllLowStock.length} medications are running low.`}
                  </div>
                </button>
                <button onClick={() => dismissLowStockBanner(freshAllLowStock)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}
            {/* Day nav: same idiom as the Food Tracker's own Log-tab date
                switcher (screens-food.jsx), unbounded both ways. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => shiftDay(-1)} aria-label="Previous day" style={mdNavBtn()}>
                <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{dayLabel}</div>
                <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
                  <button aria-label="Jump to date" style={mdIconBtn(26)}>
                    <i className="fa-solid fa-calendar-day" style={{ fontSize: 12 }} />
                  </button>
                  <input type="date" value={curDate}
                    onChange={e => e.target.value && setCurDate(e.target.value)}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                  />
                </div>
              </div>
              <button onClick={() => shiftDay(1)} aria-label="Next day" style={mdNavBtn()}>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: 12 }} />
              </button>
            </div>

            {/* Hero: same BracketFrame-plus-ring shape as the Water tracker's
                own daily hero (screens-water.jsx), ring first (left), stats
                second (right), matching the Food Log's own hero too
                (FdHeroContent, screens-food.jsx). Gated on there being
                anything due at all (a medication-free day, or one with
                nothing scheduled, has no ratio worth showing). The ring
                itself already carries the taken/due fraction (MdDoseRing),
                so the status line stays to a single sentence rather than
                repeating that same number a second time; the streak below
                it is Water's own fire-icon idiom (a different, multi-day
                stat, not a repeat of today's count). */}
            {doseTally.due > 0 && (
              <BracketFrame gold style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
                  <MdDoseRing taken={doseTally.taken} due={doseTally.due} />
                  <div>
                    <div className="micro" style={{ color: UI.inkFaint }}>{dayLabel}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, marginTop: 6 }}>
                      {doseTally.taken >= doseTally.due
                        ? 'All doses taken'
                        : `${doseTally.due - doseTally.taken} dose${doseTally.due - doseTally.taken === 1 ? '' : 's'} still due`}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                      <i className="fa-solid fa-fire" style={{ fontSize: 12, color: streak > 0 ? UI.gold : UI.inkFaint }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: streak > 0 ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi }}>
                        {streak} day{streak === 1 ? '' : 's'} streak
                      </span>
                    </div>
                  </div>
                </div>
              </BracketFrame>
            )}

            {!activeMedications.length && (
              <div style={mdEmptyHint}>Add a medication in the Schedule tab to start logging doses.</div>
            )}

            {/* Hourly timeline: every hour 0-23 always renders, filled or
                not, same reasoning as the Food Tracker's own hour rows. No
                meal-category grouping layer here, that's a food-specific
                concept medications have no equivalent of: one continuous
                24-hour list instead. */}
            <div>
              <Bezel style={{ marginBottom: 10 }}>Timeline</Bezel>
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <MdHourTrunk />
                {/* Only occupied hours plus the current real hour (whether
                    occupied or not) render; an empty hour on any other slot
                    is just noise, unlike Food's own hour grid (which always
                    shows all 24, no "current hour" carve-out was requested
                    there). */}
                {Array.from({ length: 24 }, (_, h) => h)
                  .filter(h => (byHour[h] || []).length > 0 || (curDate === today && h === new Date().getHours()))
                  .map(h => {
                  const es = byHour[h] || [];
                  const filled = es.length > 0;
                  const isNow = curDate === today && h === new Date().getHours();
                  return (
                    <div key={h} style={{ display: 'flex', alignItems: 'center' }}>
                      <MdHourTick />
                      <div style={{ ...mdHourRow(filled, isNow), flex: 1, minWidth: 0 }}>
                        <div style={mdHourLabelCol}>
                          <span className="num" style={{ fontSize: 11, fontWeight: isNow ? 700 : 400, color: isNow ? 'var(--accent)' : (filled ? UI.inkSoft : UI.inkGhost) }}>{String(h).padStart(2, '0')}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {filled ? es.map(entry => (
                            <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: entry.isPreview ? 0.6 : (entry.planned ? 0.7 : 1) }}>
                              {entry.isPreview
                                ? <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 4, border: `1.5px dashed ${UI.hairStrong}` }} />
                                : <MdCheckbox checked={!entry.planned} onToggle={() => toggleTaken(entry)} label={entry.planned ? 'Mark as taken' : 'Mark as not taken'} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={mdEntryName}>{entry.medicationName}</div>
                                <div style={mdEntryMeta}>{entry.isPreview ? 'Scheduled · ' : ''}{mdFmtQty(entry.doseQty, medications.find(m => m.id === entry.medicationId)?.unitLabel)}</div>
                              </div>
                              {!entry.isPreview && (
                                <button onClick={() => deleteLogEntry(entry)} aria-label="Delete entry" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, WebkitTapHighlightColor: 'transparent' }}>
                                  <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                                </button>
                              )}
                            </div>
                          )) : <div style={{ flex: 1 }} />}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => openLogSheet(h)} aria-label={`Log a dose at ${String(h).padStart(2, '0')}:00`} style={mdHourAddBtn(isNow)} disabled={!activeMedications.length}>
                            <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
                          </button>
                          {/* Only once there's more than one dose AND at
                              least one is still due: several at the same
                              hour are usually taken together, but the
                              shortcut has nothing left to do (and nothing to
                              confirm) once they're all already checked off,
                              see checkAllHour's own guard. */}
                          {es.filter(e => !e.isPreview && e.planned).length > 1 && (
                            <button onClick={() => checkAllHour(h, es)} aria-label={`Mark all doses at ${String(h).padStart(2, '0')}:00 as taken`} style={mdHourAddBtn(isNow)}>
                              <i className="fa-solid fa-check-double" style={{ fontSize: 11 }} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {screenTab === 'schedule' && (
          !viewedPlan ? (
            <>
              {isCoach && <SubTabBar tabs={[{ id: 'mine', label: 'My Plans' }, { id: 'templates', label: 'Client Templates' }]} active={planSubTab} onChange={setPlanSubTab} style={{ padding: 0, marginBottom: 4 }} />}
              <Btn onClick={() => openPlanNameDraft({ id: null, name: '' })} style={{ width: '100%' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> New plan
              </Btn>
              {!plans.length ? (
                <Empty title="No plans yet" sub="A plan groups medications you take for the same reason, vitamins, a cycle, whatever makes sense to you."
                  icon={<i className="fa-solid fa-folder-open" style={{ fontSize: 28, color: UI.inkFaint }} />} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Mirrors the Training Plan list's own active/plain card
                      split (screens-schedule.jsx): an active plan gets the
                      gold BracketFrame treatment, a paused one is a plain
                      Frame, same visual language as the training screen's
                      "is this the one that's actually running" signal. */}
                  {plans.map(p => {
                    const planMeds = activeMedications.filter(m => medicationPlanItems.some(it => it.medicationPlanId === p.id && it.medicationId === m.id));
                    const CardFrame = p.active ? BracketFrame : Frame;
                    return (
                      <CardFrame key={p.id} {...(p.active ? { gold: true } : {})} onClick={() => setViewedPlanId(p.id)} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div className="display" style={{ fontSize: p.active ? 22 : 20, color: p.active ? UI.gold : UI.ink, lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                          {!p.active && <span style={mdTagPill(false)}>PAUSED</span>}
                          {p.active && <Pill gold>active</Pill>}
                        </div>
                        <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>
                          {planMeds.length} medication{planMeds.length === 1 ? '' : 's'}
                        </div>
                        {planMeds.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {planMeds.map(m => <Pill key={m.id} gold={p.active}>{m.name}</Pill>)}
                          </div>
                        )}
                      </CardFrame>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Header mirrors the Training Plan viewer's own TopBar shape
                  (bordered back-chevron, subtitle+title, small text button
                  top-right), hand-built here rather than nesting the real
                  TopBar component: that one is `position: sticky, top: 0`,
                  which would fight with the Medications screen's own outer
                  TopBar for the same sticky slot once this content scrolls. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <button onClick={() => setViewedPlanId(null)} aria-label="Back to plans" style={{ ...mdNavBtn(), color: UI.gold }}>
                  <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="micro" style={{ marginBottom: 2 }}>{viewedPlanMeds.length} medication{viewedPlanMeds.length === 1 ? '' : 's'}</div>
                  <div className="display" style={{ fontSize: 22, color: UI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{viewedPlan.name}</div>
                </div>
                <button className="label" onClick={() => openPlanNameDraft({ id: viewedPlan.id, name: viewedPlan.name })} style={{ ...mdEditBtn, flexShrink: 0 }}>Rename</button>
              </div>
              {/* Tappable status bar, mirrors the Training Plan viewer's own
                  "● Active" bar (screens-schedule.jsx): same gold-filled/
                  bordered look when active, but here it IS the toggle itself
                  (several plans can be active at once, unlike Training's
                  single active pointer, so this is a real on/off switch, not
                  a read-only status). */}
              <button onClick={() => togglePlanActive(viewedPlan)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: `1px solid ${viewedPlan.active ? UI.goldSoft : UI.hairStrong}`, borderRadius: 4,
                background: viewedPlan.active ? UI.goldFaint : 'transparent',
                padding: '10px 14px', minHeight: 44, width: '100%', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: viewedPlan.active ? UI.gold : UI.inkFaint, flexShrink: 0 }} />
                <span className="label" style={{ color: viewedPlan.active ? UI.gold : UI.inkFaint, marginBottom: 0 }}>
                  {viewedPlan.active ? 'Active, doses fire on schedule' : "Paused, tap to activate"}
                </span>
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* "Add" not "Add medication": sharing the row with Coach at
                    flex:1 halves its width, the full label wrapped to two
                    lines there. Unambiguous in context, the screen is
                    already titled with the plan and lists medications. */}
                <Btn onClick={openAddToPlan} style={{ flex: 1 }}>
                  <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add
                </Btn>
                {isCoach && <Btn kind="ghost" onClick={() => setCoachMenuOpen(true)} style={{ flex: 1 }}>Coach</Btn>}
              </div>
              {!viewedPlanMeds.length ? (
                <Empty title="Nothing in this plan yet" sub="Add a medication you've already created in the Medications tab."
                  icon={<i className="fa-solid fa-pills" style={{ fontSize: 28, color: UI.inkFaint }} />} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {viewedPlanMeds.map(m => renderMedListRow(m, { mode: 'schedule', planId: viewedPlanId }))}
                </div>
              )}
            </>
          )
        )}

        {screenTab === 'inventory' && (
          <>
            {/* Sub-tab labeled "Stock", not "Inventory": the outer top-level
                tab is already called Inventory, repeating the same word one
                level down read as a mistake, not a hierarchy. */}
            <SubTabBar tabs={[{ id: 'medications', label: 'Medications' }, { id: 'inventory', label: 'Stock' }]} active={invSubTab} onChange={setInvSubTab} style={{ padding: 0, marginBottom: 4 }} />
            {invSubTab === 'inventory' ? (
              <>
                {stockBackfillError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <i className="fa-solid fa-triangle-exclamation" title="Stock estimate may be outdated. Retry by reopening this tab." style={{ fontSize: 10, color: UI.inkFaint }} />
                    <span style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>Stock estimate may be outdated</span>
                  </div>
                )}
                {freshLowStock.length > 0 && (
                  <div style={{ background: 'rgba(var(--warn-rgb),0.14)', border: '1px solid rgba(var(--warn-rgb),0.45)', borderRadius: 6, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 15, color: 'var(--warn)', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                      {freshLowStock.length === 1 ? `${freshLowStock[0].name} is running low.` : `${freshLowStock.length} medications are running low.`}
                    </div>
                    <button onClick={() => dismissLowStockBanner(freshLowStock)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                      <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                    </button>
                  </div>
                )}
                {lowStockList.length > 0 && (
                  <div className="low-stock-glow" style={{ background: 'rgba(var(--warn-rgb),0.08)', border: '1px solid rgba(var(--warn-rgb),0.35)', borderRadius: 8, padding: '14px 14px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
                      <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 12, color: 'var(--warn)' }} />
                      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--warn)', fontFamily: UI.fontUi }}>Running Low</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {lowStockList.map(renderMedRow)}
                    </div>
                  </div>
                )}
                {!inventoryList.length ? (
                  <Empty title="No medications yet" sub="Add one in the Medications tab to start tracking it here."
                    icon={<i className="fa-solid fa-box-open" style={{ fontSize: 28, color: UI.inkFaint }} />} />
                ) : (
                  <>
                    {renderSearchAndFilterRow()}
                    {!mainInventoryList.length ? (
                      <div style={mdEmptyHint}>Nothing matches this filter.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {mainInventoryList.map(renderMedRow)}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {/* The actual create/edit surface for a medication, entirely
                    independent of any plan (membership is many-to-many via
                    zane_medication_plan_items). A plan's own "Add medication"
                    only ever attaches one already created here, never
                    creates it fresh tied to that plan, so removing one from
                    a plan never has to destroy it. */}
                <Btn onClick={() => openMedSheet(null)} style={{ width: '100%' }}>
                  <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add medication
                </Btn>
                {!inventoryList.length ? (
                  <Empty title="No medications yet" sub="Create one here, then add it to a plan (or several, one at a time) whenever you're ready."
                    icon={<i className="fa-solid fa-pills" style={{ fontSize: 28, color: UI.inkFaint }} />} />
                ) : (
                  <>
                    {renderSearchAndFilterRow()}
                    {!filteredInventoryBase.length ? (
                      <div style={mdEmptyHint}>Nothing matches this filter.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {filteredInventoryBase.map(m => renderMedListRow(m, { showPlanTag: true }))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Log an ad-hoc dose */}
      <Sheet open={!!logDraft} onClose={() => setLogDraft(null)} title="Log a dose" titleColor="var(--accent)">
        {logDraft && (
          <>
            {logDraft.hour != null && (
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12 }}>
                Logging at {String(logDraft.hour).padStart(2, '0')}:00 on {dayLabel}
              </div>
            )}
            <Field label="Medication" style={{ marginBottom: 14 }}>
              <select value={logDraft.medicationId} onChange={e => setLogDraft(d => ({ ...d, medicationId: e.target.value }))} style={mdInputStyle}>
                {activeMedications.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label={`Amount (${activeMedications.find(m => m.id === logDraft.medicationId)?.unitLabel || 'pills'})`} style={{ marginBottom: 16 }}>
              <input value={logDraft.doseQtyStr} onChange={e => setLogDraft(d => ({ ...d, doseQtyStr: mdDecimalFilter(e.target.value) }))}
                type="text" inputMode="decimal" placeholder="e.g. 2" style={mdInputStyle} autoFocus />
            </Field>
            <Btn onClick={saveLogDraft} disabled={!mdNum(logDraft.doseQtyStr)} style={{ width: '100%' }}>Log it</Btn>
          </>
        )}
      </Sheet>

      {/* Inventory tab: stock-only. Identity/category/schedule stay behind
          the Schedule tab's medication sheet on purpose, see stockSheet. */}
      <Sheet open={!!stockSheet} onClose={() => setStockSheet(null)} title={stockSheet?.name || 'Update stock'} titleColor="var(--accent)">
        {stockSheet && (
          <>
            {effectiveStockById.get(stockSheet.id) != null && (
              <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 12 }}>
                Current stock: <span className="num">{mdFmtQty(effectiveStockById.get(stockSheet.id), stockSheet.unitLabel)}</span>
              </div>
            )}
            {stockSheet.packageSize > 0 ? (
              // Package size known, so stock is worth entering in packs
              // instead of doing the pack-to-unit math yourself: "10 packs"
              // beats "360 IU", and "10 packs + 18 IU" (a partially used
              // one on top of sealed ones) beats guessing a single number.
              // Either field alone still works. Same combo as the Food
              // Tracker's own stock update (screens-food.jsx).
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <Field label="Full packs" accent style={{ flex: 1, marginBottom: 0 }}>
                    <input value={stockSheet.stockPacksStr} onChange={e => setStockSheet(d => ({ ...d, stockPacksStr: mdDecimalFilter(e.target.value) }))}
                      type="text" inputMode="decimal" placeholder="e.g. 10" style={mdInputStyle} autoFocus />
                  </Field>
                  <Field label={`+ ${stockSheet.unitLabel || 'pills'}`} accent style={{ flex: 1, marginBottom: 0 }}>
                    <input value={stockSheet.stockExtraStr} onChange={e => setStockSheet(d => ({ ...d, stockExtraStr: mdDecimalFilter(e.target.value) }))}
                      type="text" inputMode="decimal" placeholder="e.g. 18" style={mdInputStyle} />
                  </Field>
                </div>
                {/* Live confirmation of the packs+extra math while typing,
                    same value saveStockSheet would actually write (both go
                    through mdStockSheetTotal), only in packs mode: plain
                    mode's single field already shows its own number, a
                    "Total" restating it would be pure noise. */}
                {mdStockSheetTotal(stockSheet) != null && (
                  <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 12 }}>
                    Total: <span className="num">{mdFmtQty(mdStockSheetTotal(stockSheet), stockSheet.unitLabel)}</span>
                  </div>
                )}
              </>
            ) : (
              <Field label={`Update stock (${stockSheet.unitLabel || 'pills'})`} accent style={{ marginBottom: 6 }}>
                <input value={stockSheet.stockStr} onChange={e => setStockSheet(d => ({ ...d, stockStr: mdDecimalFilter(e.target.value) }))}
                  type="text" inputMode="decimal" placeholder="e.g. 60 after restocking" style={mdInputStyle} autoFocus />
              </Field>
            )}
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '16px' }}>
              Tracks what's actually taken since. Leave blank to keep the current count unchanged.
            </div>
            <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginBottom: 14 }}>
              <Field label={`Warn when below (${stockSheet.unitLabel || 'units'})`} accent style={{ marginBottom: 6 }}>
                <input value={stockSheet.lowStockThresholdStr} onChange={e => setStockSheet(d => ({ ...d, lowStockThresholdStr: mdDecimalFilter(e.target.value) }))}
                  type="text" inputMode="decimal" placeholder="e.g. 10" style={mdInputStyle} />
              </Field>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 14, lineHeight: '16px' }}>
                Running Low fires under this. Defaults to one package, raise it for anything that runs out faster than a package lasts.
              </div>
              <Row label="Cycle only" first>
                <Toggle on={!!stockSheet.excludeFromLowStock} onToggle={() => setStockSheet(d => ({ ...d, excludeFromLowStock: !d.excludeFromLowStock }))} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>
                Keeps tracking stock, but skips the Running Low warning. For something you're using up for one cycle and won't be reordering.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {effectiveStockById.get(stockSheet.id) != null && (
                <Btn kind="ghost" onClick={clearStockSheet} style={{ flex: 1, color: UI.danger }}>Stop tracking</Btn>
              )}
              <Btn onClick={saveStockSheet} style={{ flex: effectiveStockById.get(stockSheet.id) != null ? 2 : 1 }}>Save</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* Stock filter sheet, mirrors the Exercises library's own filter
          sheet (screens-lib.jsx) exactly: a GoldSectionLabel per axis, each
          holding checkable Pills. */}
      <Sheet open={stockFiltersOpen} onClose={() => setStockFiltersOpen(false)} title="Filter" titleColor="var(--accent)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <MdGoldLabel>CATEGORY</MdGoldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MED_CATEGORIES.map(c => (
                <Pill key={c.id} gold={stockFilterCategories.includes(c.id)} onClick={() => toggleStockFilterCategory(c.id)} style={{ cursor: 'pointer' }}>{c.label}</Pill>
              ))}
            </div>
          </div>
          <div>
            <MdGoldLabel>PLAN</MdGoldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <Pill gold={stockFilterInPlan === 'in'} onClick={() => toggleStockFilterInPlan('in')} style={{ cursor: 'pointer' }}>In a plan</Pill>
              <Pill gold={stockFilterInPlan === 'out'} onClick={() => toggleStockFilterInPlan('out')} style={{ cursor: 'pointer' }}>Not in a plan</Pill>
            </div>
          </div>
          {stockFilterActiveCount > 0 && <Btn kind="ghost" onClick={clearStockFilters}>Clear all filters</Btn>}
        </div>
      </Sheet>

      {/* Create/rename a plan */}
      <Sheet open={!!planNameDraft} onClose={requestClosePlanNameDraft} title={planNameDraft?.id ? 'Rename plan' : 'New plan'} titleColor="var(--accent)">
        {planNameDraft && (
          <>
            <Field label="Name" style={{ marginBottom: 16 }}>
              <TextInput value={planNameDraft.name} onChange={v => setPlanNameDraft(d => ({ ...d, name: v }))} placeholder="e.g. Vitamins" autoFocus />
            </Field>
            <Btn onClick={() => { planNameDraft.id ? renamePlan(planNameDraft.id, planNameDraft.name) : createPlan(planNameDraft.name); setPlanNameDraft(null); }} style={{ width: '100%' }}>Save</Btn>
            {planNameDraft.id && (
              <Btn kind="ghost" onClick={() => { const p = viewedPlan; setPlanNameDraft(null); deletePlan(p); }} style={{ width: '100%', marginTop: 8, color: UI.danger }}>Delete plan</Btn>
            )}
          </>
        )}
      </Sheet>

      {/* Add one or more existing medications (from anywhere, whether or not
          already in some other plan too) to the viewed plan. Creating a new
          medication only ever happens in the Inventory tab's Medications
          sub-tab, never from here (see openMedSheet). Search + category
          pills sit inline under the title, mirroring ExercisePicker
          (screens-schedule.jsx) rather than the Inventory tab's separate
          Filter sheet: this is already its own single-purpose picker sheet,
          nesting another sheet inside it would be one layer too many. */}
      <Sheet open={addToPlanOpen} onClose={() => setAddToPlanOpen(false)} title="Add medication" titleColor="var(--accent)">
        {availableToAddMeds.length === 0 ? (
          <div style={mdEmptyHint}>Every medication you have is already in this plan. Create a new one in the Medications tab first.</div>
        ) : (
          <>
            <Field label="">
              <TextInput value={addPlanSearch} onChange={setAddPlanSearch} placeholder="Search…" />
            </Field>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 12 }}>
              {MED_CATEGORIES.map(c => (
                <Pill key={c.id} gold={addPlanCategories.includes(c.id)} onClick={() => toggleAddPlanCategory(c.id)} style={{ cursor: 'pointer' }}>{c.label}</Pill>
              ))}
            </div>
            {filteredAvailableToAddMeds.length === 0 ? (
              <div style={mdEmptyHint}>Nothing matches this filter.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredAvailableToAddMeds.map(m => {
                  const isSel = addPlanSelected.includes(m.id);
                  return (
                    <button key={m.id} onClick={() => toggleAddPlanSelect(m.id)} style={{
                      ...mdQuickRowInner, display: 'flex', justifyContent: 'space-between', textAlign: 'left',
                      background: isSel ? UI.goldFaint : UI.bgInset,
                      border: `var(--hair-width) solid ${isSel ? UI.goldSoft : UI.hair}`,
                    }}>
                      <span style={{ ...mdEntryName, color: isSel ? UI.gold : UI.ink }}>{m.name}</span>
                      {isSel
                        ? <i className="fa-solid fa-circle-check" style={{ fontSize: 15, color: UI.gold }} />
                        : <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>
            )}
            {addPlanSelected.length > 0 && (
              <Btn onClick={confirmAddToPlan} style={{ width: '100%', marginTop: 12 }}>
                Add {addPlanSelected.length} medication{addPlanSelected.length === 1 ? '' : 's'}
              </Btn>
            )}
          </>
        )}
      </Sheet>

      {/* Edit / create a medication: identity only (name, brand, category,
          unit, package size), see the header comment's split. Schedule
          editing for an existing medication lives in the separate schedMed
          Sheet below instead, never here. */}
      <Sheet open={!!medSheet} onClose={requestCloseMedSheet} title={medSheet?.id ? 'Edit medication' : 'Add medication'} titleColor="var(--accent)">
        {medSheet && (
          <>
            <Field label="Name" accent style={{ marginBottom: 14 }}>
              <TextInput value={medSheet.name} onChange={v => setMedSheet(d => ({ ...d, name: v }))} placeholder="e.g. Vitamin D3" autoFocus />
            </Field>
            <Field label="Brand (optional)" accent style={{ marginBottom: 14 }}>
              <TextInput value={medSheet.brand} onChange={v => setMedSheet(d => ({ ...d, brand: v }))} placeholder="e.g. Nature's Own" />
            </Field>
            <div className="micro-gold" style={{ marginBottom: 6 }}>Category</div>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 14 }}>
              {MED_CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setMedSheet(d => ({ ...d, category: d.category === c.id ? '' : c.id }))} style={mdSegBtn(medSheet.category === c.id)}>{c.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <Field label="Unit" accent style={{ flex: 1, marginBottom: 0 }}>
                <TextInput value={medSheet.unitLabel} onChange={v => setMedSheet(d => ({ ...d, unitLabel: v }))} placeholder="pills" />
              </Field>
              <Field label="Package size" accent style={{ flex: 1, marginBottom: 0 }}>
                <input value={medSheet.packageSizeStr} onChange={e => setMedSheet(d => ({ ...d, packageSizeStr: mdDecimalFilter(e.target.value) }))}
                  type="text" inputMode="decimal" placeholder="e.g. 60" style={mdInputStyle} />
              </Field>
            </div>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: -8, marginBottom: 14, lineHeight: '16px' }}>
              Total amount in one container (e.g. a whole vial or bottle), not the dose. A vial labeled "250mg/ml" at 10ml holds 2500mg total. Dose is set separately per scheduled time.
            </div>
            <div style={{ marginBottom: 14 }}>
              <Row label="Track Medication Stock" first>
                <Toggle on={!!medSheet.trackStock} onToggle={() => setMedSheet(d => ({ ...d, trackStock: !d.trackStock }))} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>
                {medSheet.trackStock
                  ? 'Set the Running Low threshold and Cycle only from Inventory > Stock, tap this medication there.'
                  : "Off drops this medication from Inventory's Stock view entirely, for one you'll never bother counting."}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Row label="Exclude from pillbox" first>
                <Toggle on={!!medSheet.excludeFromPillbox} onToggle={() => setMedSheet(d => ({ ...d, excludeFromPillbox: !d.excludeFromPillbox }))} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>
                Never show this in Weekly Prep, e.g. an injectable that doesn't go in a pill organizer.
              </div>
            </div>
            {medSheet.id && medSheetMemberships.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="micro-gold" style={{ marginBottom: 8 }}>In these plans</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {medSheetMemberships.map(it => (
                    <div key={it.id} style={{ ...mdQuickRowInner, cursor: 'default' }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>
                        {medicationPlans.find(p => p.id === it.medicationPlanId)?.name || 'Unknown plan'}
                      </div>
                      <button onClick={() => removeMedicationFromPlan(medications.find(m => m.id === medSheet.id), it.medicationPlanId)} aria-label="Remove from plan" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4 }}>
                        <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {medSheet.id && <Btn kind="ghost" onClick={() => deleteMedication(medications.find(m => m.id === medSheet.id))} style={{ flex: 1, color: UI.danger }}>Delete</Btn>}
              <Btn onClick={saveMedSheet} disabled={!medSheet.name.trim()} style={{ flex: medSheet.id ? 2 : 1 }}>Save</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* View/edit a medication's schedule only, opened from a plan's own
          detail view (renderMedListRow's mode: 'schedule'). The exact
          counterpart to medSheet above: strictly time-only, never an
          identity field, see the header comment's split. The medication's
          name is a read-only title here, editing it lives exclusively in
          medSheet (Inventory > Medications). No Save button of its own:
          saveSlotDraft/deleteSlot below write straight to the store per
          slot, there's nothing else here to persist. */}
      <Sheet open={!!schedMed && !slotDraft} onClose={closeSchedMed} title={schedMed?.name || 'Schedule'} titleColor="var(--accent)"
        titleRight={schedMed && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMovePlanOpen(true)} aria-label="Move to another plan" style={mdIconBtn(30)}>
              <i className="fa-solid fa-right-left" style={{ fontSize: 13 }} />
            </button>
            {/* Small icon next to Move rather than the earlier full-width
                button below Add time: the only other place this same action
                was reachable from is medSheet's own per-membership list
                (Inventory > Medications), several taps away from here, so
                this is the direct route from where the user is actually
                looking at this plan's schedule. Awaits
                removeMedicationFromPlan's own confirm() and only closes
                schedMed if it actually went through (its return value
                distinguishes a real removal from a cancel), since a
                cancelled confirm should leave this sheet exactly as-is. */}
            <button onClick={async () => {
              const med = medications.find(m => m.id === schedMed.id);
              if (await removeMedicationFromPlan(med, schedMed.medicationPlanId)) closeSchedMed();
            }} aria-label="Remove from plan" style={{ ...mdIconBtn(30), color: UI.danger }}>
              <i className="fa-solid fa-trash" style={{ fontSize: 13 }} />
            </button>
          </div>
        )}
      >
        {schedMed && (
          <>
            {schedMedSlots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {schedMedSlots.map(sl => (
                  <div key={sl.id} style={{ ...mdQuickRowInner, cursor: 'default' }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>
                      {mdSlotDaysLabel(sl)} {String(sl.hour).padStart(2, '0')}:00 · {mdFmtQty(sl.doseQty, schedMed.unitLabel)}
                      {(sl.startDate || sl.endDate) && <span style={{ color: UI.inkFaint }}> ({sl.startDate || '…'} → {sl.endDate || '…'})</span>}
                    </div>
                    <button onClick={() => openSlotDraft(sl)} aria-label="Edit time" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4 }}><i className="fa-solid fa-pen" style={{ fontSize: 11 }} /></button>
                    <button onClick={() => deleteSlot(sl)} aria-label="Delete time" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4 }}><i className="fa-solid fa-xmark" style={{ fontSize: 14 }} /></button>
                  </div>
                ))}
              </div>
            )}
            <Btn kind="ghost" onClick={() => openSlotDraft(null)} style={{ width: '100%' }}><i className="fa-solid fa-plus" style={{ marginRight: 8 }} />Add time</Btn>
          </>
        )}
      </Sheet>

      {/* Move this medication, and this plan's own schedule for it, into a
          different plan of the same bucket, opened from schedMed's own
          titleRight button above. Tapping a target plan moves immediately,
          same zero-friction immediacy as the "Add medication" picker; each
          target's own paused state is shown right in the list so the user
          sees upfront whether doses keep firing after the move, no separate
          confirm dialog needed since nothing is destroyed, only relocated. */}
      <Sheet open={movePlanOpen} onClose={() => setMovePlanOpen(false)} title="Move to plan" titleColor="var(--accent)">
        {moveTargetPlans.length === 0 ? (
          <div style={mdEmptyHint}>No other plan to move this into yet. Create one first.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {moveTargetPlans.map(p => (
              <button key={p.id} onClick={() => moveMedicationToPlan(p.id)} style={{ ...mdQuickRowInner, display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}>
                <span style={mdEntryName}>{p.name}</span>
                {!p.active && <span style={mdTagPill(false)}>PAUSED</span>}
              </button>
            ))}
          </div>
        )}
      </Sheet>

      {/* Add/edit one schedule slot, nested within the schedMed sheet above */}
      <Sheet open={!!slotDraft} onClose={requestCloseSlotDraft} title={slotDraft?.id ? 'Edit time' : 'Add time'} titleColor="var(--accent)">
        {slotDraft && (() => {
          const isInterval = slotDraft.mode === 'interval';
          const reversedRange = slotDraft.startDate && slotDraft.endDate && slotDraft.startDate > slotDraft.endDate;
          return (
          <>
            {/* Weekdays vs every-N-days are mutually exclusive per slot (see
                saveSlotDraft): most compounds run on fixed weekdays, but many
                (peptides especially) are dosed every 2/3/x days instead, with
                no weekday pattern to pick at all. */}
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 16 }}>
              <button onClick={() => setSlotDraft(d => ({ ...d, mode: 'weekdays' }))} style={mdSegBtn(!isInterval)}>Weekdays</button>
              <button onClick={() => setSlotDraft(d => ({ ...d, mode: 'interval' }))} style={mdSegBtn(isInterval)}>Every X days</button>
            </div>
            {isInterval ? (
              <>
                <div className="micro" style={{ marginBottom: 6 }}>Every</div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <Stepper value={slotDraft.intervalDaysNum} step={1} min={2} max={90} suffix={slotDraft.intervalDaysNum === 1 ? ' day' : ' days'}
                    onChange={v => setSlotDraft(d => ({ ...d, intervalDaysNum: Math.max(2, Math.min(90, Math.round(v))) }))} big />
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="micro">Days</div>
                  <button onClick={selectAllWeekdays} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11, fontFamily: UI.fontUi, cursor: 'pointer' }}>Select all days</button>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                  {MD_WEEKDAY_SHORT.map((label, wd) => (
                    <button key={wd} onClick={() => toggleWeekday(wd)} style={{
                      flex: 1, padding: '8px 2px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: UI.fontUi,
                      border: `1px solid ${slotDraft.weekdays.includes(wd) ? 'var(--accent)' : UI.hairStrong}`,
                      background: slotDraft.weekdays.includes(wd) ? 'var(--accent)' : 'transparent',
                      color: slotDraft.weekdays.includes(wd) ? 'var(--accent-ink)' : UI.inkFaint,
                      textShadow: slotDraft.weekdays.includes(wd) ? 'none' : 'var(--text-lift)',
                      WebkitTapHighlightColor: 'transparent',
                    }}>{label}</button>
                  ))}
                </div>
              </>
            )}
            <div className="micro" style={{ marginBottom: 6 }}>Time</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Stepper value={slotDraft.hour} step={1} min={0} max={23} suffix=":00" onChange={v => setSlotDraft(d => ({ ...d, hour: Math.max(0, Math.min(23, Math.round(v))) }))} big />
            </div>
            <Field label={`Dose (${schedMed?.unitLabel || 'pills'})`} style={{ marginBottom: 14 }}>
              <input value={slotDraft.doseQtyStr} onChange={e => setSlotDraft(d => ({ ...d, doseQtyStr: mdDecimalFilter(e.target.value) }))}
                type="text" inputMode="decimal" placeholder="e.g. 1" style={mdInputStyle} autoFocus />
            </Field>
            {isInterval ? (
              // Not collapsible like the weekday-mode range below: startDate
              // is the count-from anchor here, not an optional phase bound,
              // so it's always shown and always required (see saveSlotDraft).
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Field label="Starting" accent style={{ flex: 1, marginBottom: 0 }}>
                    <input type="date" value={slotDraft.startDate} onChange={e => setSlotDraft(d => ({ ...d, startDate: e.target.value }))} style={mdInputStyle} />
                  </Field>
                  <Field label="Until (optional)" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="date" value={slotDraft.endDate} onChange={e => setSlotDraft(d => ({ ...d, endDate: e.target.value }))} style={mdInputStyle} />
                  </Field>
                </div>
                {reversedRange && (
                  <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>
                    "Until" must be on or after "Starting".
                  </div>
                )}
              </div>
            ) : (
              <>
                <button onClick={() => setSlotDraft(d => ({ ...d, phaseOpen: !d.phaseOpen }))} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11, fontFamily: UI.fontUi, cursor: 'pointer', marginBottom: slotDraft.phaseOpen ? 10 : 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className={`fa-solid fa-chevron-${slotDraft.phaseOpen ? 'down' : 'right'}`} style={{ fontSize: 9 }} />
                  Limit to a date range (for a staged cycle)
                </button>
                {slotDraft.phaseOpen && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Field label="From" style={{ flex: 1, marginBottom: 0 }}>
                        <input type="date" value={slotDraft.startDate} onChange={e => setSlotDraft(d => ({ ...d, startDate: e.target.value }))} style={mdInputStyle} />
                      </Field>
                      <Field label="To" style={{ flex: 1, marginBottom: 0 }}>
                        <input type="date" value={slotDraft.endDate} onChange={e => setSlotDraft(d => ({ ...d, endDate: e.target.value }))} style={mdInputStyle} />
                      </Field>
                    </div>
                    {/* Same reversed-range check as saveSlotDraft's own guard,
                        surfaced here so the user sees why Save is stuck instead
                        of just finding out the button won't respond. */}
                    {reversedRange && (
                      <div style={{ fontSize: 11, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6, lineHeight: '16px' }}>
                        "To" must be on or after "From".
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <Btn onClick={saveSlotDraft} disabled={(isInterval ? !slotDraft.startDate : !slotDraft.weekdays.length) || !mdNum(slotDraft.doseQtyStr) || reversedRange} style={{ width: '100%' }}>Save</Btn>
          </>
          );
        })()}
      </Sheet>

      {/* Coach: push to client / template bucket */}
      <Sheet open={coachMenuOpen} onClose={() => setCoachMenuOpen(false)} title="Coaching" titleColor="var(--accent)">
        {viewedPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn onClick={() => { const p = viewedPlan; setCoachMenuOpen(false); setPushPlan(p); }} style={{ width: '100%' }}>
              <i className="fa-solid fa-paper-plane" style={{ marginRight: 8 }} /> Push to client
            </Btn>
            <Btn kind="ghost" onClick={() => toggleTemplate(viewedPlan)} style={{ width: '100%' }}>
              <i className="fa-solid fa-user-group" style={{ marginRight: 8 }} /> {viewedPlan.isTemplate ? 'Move to My Plans' : 'Mark as client template'}
            </Btn>
          </div>
        )}
      </Sheet>
      <Sheet open={!!pushPlan && !pushTarget} onClose={() => setPushPlan(null)} title="Push to client" titleColor="var(--accent)">
        {pushPlan && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: 1.5 }}>
              Copies "{pushPlan.name}" and its medications into a client's account, alongside whatever else they already have.
            </div>
            {coachClients.length === 0 ? <div style={mdEmptyHint}>No active clients.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {coachClients.map(c => (
                  <button key={c.id} onClick={() => setPushTarget(c)} style={{ ...mdQuickRowInner, display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}>
                    <span style={{ flex: 1, textAlign: 'left', ...mdEntryName }}>{c.clientName || 'Client'}</span>
                    <i className="fa-solid fa-chevron-right" style={{ fontSize: 12, color: UI.inkFaint }} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
      <Sheet open={!!pushTarget} onClose={() => !pushBusy && setPushTarget(null)} title={pushTarget?.clientName || 'Client'} titleColor="var(--accent)">
        {pushTarget && pushPlan && (
          <>
            <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
              Push "{pushPlan.name}" to {pushTarget.clientName || 'this client'}? It runs alongside anything else they're already tracking.
            </div>
            <Btn onClick={doPush} disabled={pushBusy} style={{ width: '100%' }}>{pushBusy ? 'Pushing…' : 'Push'}</Btn>
          </>
        )}
      </Sheet>
      <Sheet open={!!pushDone} onClose={() => setPushDone(null)} title="Pushed" titleColor="var(--accent)">
        {pushDone && (
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: '20px' }}>
            "{pushDone.planName}" is in {pushDone.clientName}'s account now.
          </div>
        )}
      </Sheet>
      <WeeklyPrepScreen open={weeklyPrepOpen} onClose={() => setWeeklyPrepOpen(false)} store={store} setStore={setStore} userId={userId} />
    </Screen>
  );
}

// ── Weekly Prep: a pillbox-packing checklist for the coming 7 days ─────
// Not a route: a same-file screen toggled by MedicationsScreen's own local
// state, exactly like ShoppingListScreen sits inside FoodScreen
// (screens-food.jsx). Bucketing is a pure display-time lens over the
// existing schedule slots (LB.dsSlotAppliesOn): redefining a pillbox slot later
// can shift which compartment an already-packed dose displays under without
// touching or losing the pack-check itself. "Other times" catches a dose
// whose hour matches none of the user's slots, so nothing can silently
// disappear from the one job this screen has (don't forget anything).
const MD_PILLBOX_OTHER_BUCKET = '__other__';
function mdPillboxBucketFor(hour, pillboxSlots) {
  const matches = pillboxSlots.filter(ps => hour >= ps.startHour && hour < ps.endHour).sort((a, b) => a.startHour - b.startHour);
  return matches.length ? matches[0].id : MD_PILLBOX_OTHER_BUCKET;
}

function WeeklyPrepScreen({ open, onClose, store, setStore, userId }) {
  const [slotsSheetOpen, setSlotsSheetOpen] = useStateMd(false);
  const settings = store.settings || {};
  const patchSettings = (patch) => setStore(s => ({ ...s, settings: { ...s.settings, ...patch } }));
  const pillboxSlots = useMemoMd(
    () => (Array.isArray(settings.pillboxSlots) ? settings.pillboxSlots : []).slice().sort((a, b) => (a.startHour ?? 0) - (b.startHour ?? 0)),
    [settings.pillboxSlots],
  );

  // Archived and pillbox-excluded medications never contribute a bucket
  // entry: a slot pointing at one simply finds nothing in medsById below.
  const medsById = useMemoMd(
    () => new Map((store.medications || []).filter(m => !m.archived && !m.excludeFromPillbox).map(m => [m.id, m])),
    [store.medications],
  );
  const activePlanIds = useMemoMd(
    () => new Set((store.medicationPlans || []).filter(p => p.active).map(p => p.id)),
    [store.medicationPlans],
  );
  const checkedIds = useMemoMd(() => new Set((store.medicationPillboxChecks || []).map(c => c.id)), [store.medicationPillboxChecks]);

  const days = useMemoMd(() => {
    const todayStr = LB.todayISO();
    const medicationScheduleSlots = store.medicationScheduleSlots || [];
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = mdShiftDate(todayStr, i);
      const wd = LB.isoWd(new Date(d + 'T12:00:00'));
      const buckets = new Map();
      medicationScheduleSlots.forEach(slot => {
        if (!LB.dsSlotAppliesOn(slot, d, wd, activePlanIds)) return;
        const med = medsById.get(slot.medicationId);
        if (!med) return;
        const bucketId = mdPillboxBucketFor(slot.hour, pillboxSlots);
        if (!buckets.has(bucketId)) buckets.set(bucketId, []);
        buckets.get(bucketId).push({ med, slot });
      });
      // Alphabetical within each compartment, same convention as every
      // other name-based list in this module.
      buckets.forEach(items => items.sort((a, b) => a.med.name.localeCompare(b.med.name)));
      out.push({ date: d, buckets });
    }
    return out;
  }, [store.medicationScheduleSlots, medsById, activePlanIds, pillboxSlots]);

  const compartments = useMemoMd(
    () => [...pillboxSlots.map(s => ({ id: s.id, label: s.label })), { id: MD_PILLBOX_OTHER_BUCKET, label: 'Other times' }],
    [pillboxSlots],
  );
  // Per compartment, split into what repeats every single one of the 7 shown
  // days (packed once per medication, not read 7 times over) versus what
  // only lands on some days (still needs the per-day breakdown, since the
  // whole point there is knowing which specific day to add it). A compartment
  // is dropped entirely if it ends up with nothing in either bucket.
  const compartmentGroups = useMemoMd(() => {
    return compartments.map(c => {
      const bySlot = new Map();
      days.forEach(day => {
        (day.buckets.get(c.id) || []).forEach(({ med, slot }) => {
          if (!bySlot.has(slot.id)) bySlot.set(slot.id, { med, slot, dates: [] });
          bySlot.get(slot.id).dates.push(day.date);
        });
      });
      const entries = [...bySlot.values()];
      const daily = entries.filter(e => e.dates.length === 7).sort((a, b) => a.med.name.localeCompare(b.med.name));
      const varyingSlotIds = new Set(entries.filter(e => e.dates.length < 7).map(e => e.slot.id));
      const perDay = days
        .map((day, i) => ({ date: day.date, i, items: (day.buckets.get(c.id) || []).filter(({ slot }) => varyingSlotIds.has(slot.id)) }))
        .filter(d => d.items.length > 0);
      return { id: c.id, label: c.label, daily, perDay };
    }).filter(g => g.daily.length > 0 || g.perDay.length > 0);
  }, [compartments, days]);

  function toggleCheck(dateISO, scheduleSlotId) {
    const id = `${userId}_${dateISO}_${scheduleSlotId}`;
    setStore(s => {
      const cur = s.medicationPillboxChecks || [];
      const exists = cur.some(c => c.id === id);
      return {
        ...s,
        medicationPillboxChecks: exists ? cur.filter(c => c.id !== id) : [...cur, { id, date: dateISO, scheduleSlotId }],
      };
    });
  }

  // Every-day items get ONE checkbox for the whole week instead of 7: it
  // reflects (and toggles) all 7 underlying per-day checks together, since
  // packing a daily med is one pass across all 7 compartments, not 7
  // separate decisions. Same id shape/table as toggleCheck, just batched.
  function isWeekFullyPacked(dates, scheduleSlotId) {
    return dates.every(d => checkedIds.has(`${userId}_${d}_${scheduleSlotId}`));
  }
  function toggleCheckAllDays(dates, scheduleSlotId) {
    const fullyPacked = isWeekFullyPacked(dates, scheduleSlotId);
    setStore(s => {
      const cur = s.medicationPillboxChecks || [];
      if (fullyPacked) {
        const idsToRemove = new Set(dates.map(d => `${userId}_${d}_${scheduleSlotId}`));
        return { ...s, medicationPillboxChecks: cur.filter(c => !idsToRemove.has(c.id)) };
      }
      const existingIds = new Set(cur.map(c => c.id));
      const toAdd = dates
        .filter(d => !existingIds.has(`${userId}_${d}_${scheduleSlotId}`))
        .map(d => ({ id: `${userId}_${d}_${scheduleSlotId}`, date: d, scheduleSlotId }));
      return { ...s, medicationPillboxChecks: [...cur, ...toAdd] };
    });
  }

  function dayLabel(dateISO, i) {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    return new Date(dateISO + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  if (!open) return null;
  return (
    <Screen style={{ position: 'fixed', inset: 0, zIndex: 100, animation: 'sheet-up 0.22s ease' }}>
      <TopBar title="Weekly Prep" sub="Pillbox" onBack={onClose} right={
        <button onClick={() => setSlotsSheetOpen(true)} aria-label="Configure pillbox" style={mdTopAddBtn}>
          <i className="fa-solid fa-gear" style={{ fontSize: 14 }} />
        </button>
      } />
      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {pillboxSlots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '20px' }}>
              Set up your pillbox compartments first (e.g. Morning, Evening), then this screen shows exactly what to pack each week.
            </div>
            <Btn onClick={() => setSlotsSheetOpen(true)} style={{ width: '100%' }}>Set up pillbox</Btn>
          </div>
        ) : compartmentGroups.length === 0 ? (
          <div style={mdEmptyHint}>Nothing to pack this week</div>
        ) : compartmentGroups.map(g => (
          // Compartment first, then the days due within it: filling a real
          // pillbox goes compartment by compartment across the whole week
          // (all mornings, then all evenings), not day by day.
          <div key={g.id}>
            <Bezel style={{ marginBottom: 10 }}>{g.label}</Bezel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {g.daily.length > 0 && (
                <div>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>Every day</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {g.daily.map(({ med, slot, dates }) => {
                      const packed = isWeekFullyPacked(dates, slot.id);
                      return (
                        <div key={slot.id} style={{ ...mdListRow, cursor: 'default', opacity: packed ? 0.6 : 1 }}>
                          <MdCheckbox checked={packed} onToggle={() => toggleCheckAllDays(dates, slot.id)} label={packed ? 'Mark whole week as not packed' : 'Mark whole week as packed'} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={mdEntryName}>{med.name}</div>
                            <div style={mdEntryMeta}>{parseFloat((slot.doseQty * dates.length).toFixed(2))} for the week</div>
                          </div>
                          {/* Big, bold, accent, right-aligned: the one number
                              that has to be readable at a glance from across
                              the room while physically packing the box, the
                              small meta line next to it is not. */}
                          <div style={mdPerDayQty}>{mdFmtQty(slot.doseQty, med.unitLabel)} / day</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {g.perDay.map(day => (
                <div key={day.date}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 6 }}>{dayLabel(day.date, day.i)}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {day.items.map(({ med, slot }) => {
                      const packed = checkedIds.has(`${userId}_${day.date}_${slot.id}`);
                      return (
                        <div key={slot.id} style={{ ...mdListRow, cursor: 'default', opacity: packed ? 0.6 : 1 }}>
                          <MdCheckbox checked={packed} onToggle={() => toggleCheck(day.date, slot.id)} label={packed ? 'Mark as not packed' : 'Mark as packed'} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={mdEntryName}>{med.name}</div>
                          </div>
                          <div style={mdPerDayQty}>{mdFmtQty(slot.doseQty, med.unitLabel)} / day</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Sheet open={slotsSheetOpen} onClose={() => setSlotsSheetOpen(false)} title="Pillbox compartments" titleColor="var(--accent)">
        <MdPillboxSlotsBody settings={settings} patchSettings={patchSettings} onClose={() => setSlotsSheetOpen(false)} />
      </Sheet>
    </Screen>
  );
}

function MdPillboxSlotRow({ left, right, onEdit, onRemove, active }) {
  return (
    <div onClick={onEdit} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px',
      background: active ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset,
      border: `var(--hair-width) solid ${active ? 'rgba(var(--accent-rgb),0.35)' : UI.hair}`, borderRadius: 6, marginBottom: 6,
      cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{left}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{right}</span>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} aria-label="Remove" style={{ background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, WebkitTapHighlightColor: 'transparent' }}>
          <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  );
}
// Shared list editor for the user's own pillbox compartments (no cap, their
// choice), a structural twin of screens-water.jsx's WaterDrinksConfigBody.
// Used both from WeeklyPrepScreen's own gear icon and from Settings >
// Health & Nutrition > Medications, one source of truth for these fields.
function MdPillboxSlotsBody({ settings, patchSettings, onClose }) {
  const slots = (Array.isArray(settings.pillboxSlots) ? settings.pillboxSlots : []).slice().sort((a, b) => (a.startHour ?? 0) - (b.startHour ?? 0));
  const [label, setLabel] = useStateMd('');
  const [startHour, setStartHour] = useStateMd(6);
  const [endHour, setEndHour] = useStateMd(12);
  const [editIdx, setEditIdx] = useStateMd(null);

  const resetForm = () => { setLabel(''); setStartHour(6); setEndHour(12); setEditIdx(null); };
  const startEdit = (i) => {
    const s = slots[i];
    setLabel(s.label); setStartHour(s.startHour); setEndHour(s.endHour);
    setEditIdx(i);
  };
  const saveSlot = () => {
    if (!label.trim() || endHour <= startHour) return;
    const next = { id: editIdx != null ? slots[editIdx].id : LB.uid(), label: label.trim(), startHour, endHour };
    if (editIdx != null) {
      patchSettings({ pillboxSlots: slots.map((s, idx) => idx === editIdx ? next : s) });
    } else {
      patchSettings({ pillboxSlots: [...slots, next] });
    }
    resetForm();
  };
  const removeSlot = (i) => {
    patchSettings({ pillboxSlots: slots.filter((_, idx) => idx !== i) });
    if (editIdx === i) resetForm();
  };

  return (
    <div>
      <Bezel style={{ marginBottom: 12 }}>Compartments</Bezel>
      <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 10 }}>
        {editIdx != null ? 'Tap the row again, or another one, to change your edit.' : 'Add as many as your pillbox has. Tap one to edit it.'}
      </div>
      {slots.map((s, i) => (
        <MdPillboxSlotRow key={s.id} left={s.label} right={`${String(s.startHour).padStart(2, '0')}:00-${String(s.endHour).padStart(2, '0')}:00`}
          active={editIdx === i} onEdit={() => (editIdx === i ? resetForm() : startEdit(i))} onRemove={() => removeSlot(i)} />
      ))}
      <div style={{ marginTop: 4, marginBottom: 20 }}>
        <Field label="Label" style={{ marginBottom: 14 }}>
          <TextInput value={label} onChange={setLabel} placeholder="e.g. Morning" />
        </Field>
        <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="micro" style={{ marginBottom: 8, textAlign: 'center' }}>Start</div>
            <Stepper value={startHour} step={1} min={0} max={23} suffix=":00" onChange={v => {
              const nv = Math.max(0, Math.min(23, Math.round(v)));
              setStartHour(nv);
              setEndHour(eh => Math.max(eh, nv + 1));
            }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="micro" style={{ marginBottom: 8, textAlign: 'center' }}>End</div>
            <Stepper value={endHour} step={1} min={startHour + 1} max={24} suffix=":00" onChange={v => setEndHour(Math.max(startHour + 1, Math.min(24, Math.round(v))))} />
          </div>
        </div>
        {editIdx == null ? (
          <Btn onClick={saveSlot} disabled={!label.trim()} style={{ width: '100%' }}>Add</Btn>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={resetForm} style={{ flex: 1 }}>Cancel</Btn>
            <Btn onClick={saveSlot} disabled={!label.trim()} style={{ flex: 1 }}>Save</Btn>
          </div>
        )}
      </div>
      <Btn onClick={onClose} style={{ width: '100%' }}>Done</Btn>
    </div>
  );
}

Object.assign(window.Screens, { MedicationsScreen });
