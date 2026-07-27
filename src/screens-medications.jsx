/* Medications tracker: a personal (optionally coach-managed) log/schedule/
   inventory system for medications, vitamins and supplements, modeled closely
   on the Food Tracker's Plan Mode (zane_food_meal_plans/zane_food_template_
   slots/zane_food_logs, see screens-food.jsx) but with its own weekday-based
   schedule (not tied to training/rest day type) and its own inventory unit
   (unit_label, not always grams).

   Three tabs:
   - Timeline: today's doses (auto-filled from active schedule slots of
     active plans, same planned/logged distinction as food), plus logging an
     ad-hoc dose.
   - Schedule: named plans (My Plans / Client Templates for a coach, like
     FoodTemplateScreen). A medication's membership in a plan is many-to-many
     via zane_medication_plan_items (store.medicationPlanItems, migration
     0221): the SAME medication (one shared identity/stock row) can sit in
     several plans at once, each with its OWN schedule (a schedule slot is
     scoped to one specific (medication, plan) pair via its own
     medicationPlanId), so a coach-prescribed cycle plan can prescribe a
     different dose/timing for a medication than the user's own separate
     plan for that same product. A plan's own "Add medication" is a picker
     over medications not already IN THIS plan (any medication is eligible,
     whether or not it's already a member of some other plan), never a
     create form, so removing a medication from a plan, or deleting the
     plan itself, never destroys the medication, its OTHER plans'
     schedules, or its log history, only this plan's own membership + this
     plan's own schedule slots for it. A plan also has its own `active`
     toggle (default on): only an active plan's schedule slots fire into
     the Timeline, several plans can be active at once by design (no single
     active pointer, see zane_medication_plans in docs/database.md). A
     schedule slot's own weekday/hour/dose fields (the "Add time"
     sub-sheet) are the one place time itself is entered; there is no
     separate per-slot pause toggle (removed, found confusing): the only
     way to stop a dose is removing the medication from that plan.
   - Inventory: two sub-tabs, mirroring the Food Shopping List's own
     Shopping List/Inventory split. Inventory is the stock/low-stock view
     (its own dedicated stockSheet is the only place stock is entered),
     every non-archived medication (not just stock-tracked ones, unlike the
     Shopping List's own Inventory tab: this domain's medication list IS the
     inventory, there's no separate frequency-filtered "staple" concept
     sitting in front of it), with a Running Low section for anything
     that's dipped under its package size, and a Tracked/Not-tracked filter
     underneath. Medications is the actual create/edit/delete surface for a
     medication's identity (name, brand, category, unit, package size) ONLY,
     independent of any plan, same list as Inventory just presented for
     editing rather than for stock.

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

// ── Style constants (own copies, mirrors screens-food.jsx's fd* helpers) ──
const mdListRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, textShadow: 'none',
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const mdQuickRowInner = { ...mdListRow, flex: 1, minWidth: 0 };
const mdEntryName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const mdEntryMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi };
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
// Below one package's worth: only meaningful with both a package size and
// stock tracking on, a medication with either missing has nothing to compare
// its stock against.
function mdIsLowStock(med, effectiveStock) {
  return med.packageSize > 0 && effectiveStock != null && effectiveStock < med.packageSize;
}

// A schedule slot applies to `dateISO` if its plan is active, today's
// weekday is in its list, and (when set) dateISO falls inside its optional
// start/end date phase. Both bounds null (the default) means unbounded,
// identical to a plain always-on schedule. There is no per-slot pause flag
// (removed, see the header comment): a slot with no plan, or whose plan
// isn't in activePlanIds, is simply never due, exactly as if it didn't
// exist, no separate "orphaned" handling needed.
function mdSlotAppliesOn(slot, dateISO, wd, activePlanIds) {
  if (!slot.medicationPlanId || !activePlanIds.has(slot.medicationPlanId)) return false;
  if (!(slot.weekdays || []).includes(wd)) return false;
  if (slot.startDate && dateISO < slot.startDate) return false;
  if (slot.endDate && dateISO > slot.endDate) return false;
  return true;
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
    if (!mdSlotAppliesOn(slot, todayISO, wd, activePlanIds)) return;
    toAdd.push(mdMaterializeSlotEntry(med, slot, todayISO));
  });
  if (!toAdd.length) return;
  setStore(s => ({ ...s, medicationLogs: [...(s.medicationLogs || []), ...toAdd] }));
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

function MedicationsScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const today = LB.todayISO();
  const [screenTab, setScreenTab] = useStateMd('timeline'); // 'timeline' | 'schedule' | 'inventory'

  const medications = store.medications || [];
  const activeMedications = useMemoMd(() => medications.filter(m => !m.archived), [medications]);
  const medicationPlans = store.medicationPlans || [];
  const scheduleSlots = store.medicationScheduleSlots || [];
  const medicationLogs = store.medicationLogs || [];
  const medicationPlanItems = store.medicationPlanItems || [];

  const isCoach = (store.coaching?.asCoach || []).some(c => c.status === 'active');
  const coachClients = useMemoMd(() => (store.coaching?.asCoach || []).filter(c => c.status === 'active'), [store.coaching]);

  // Auto-fill today's due doses. medicationLogs is deliberately NOT a
  // dependency: it is, unavoidably, since mdAutoFillToday only skips a slot
  // that already has a log row. If it were listed here, deleting an
  // auto-filled entry would change medicationLogs, re-trigger this very
  // effect, and mdAutoFillToday would see the slot as no-longer-represented
  // and materialize it right back, so a delete could never stick while its
  // slot is still due today. Same exclusion the Food Tracker's own
  // template-day effect makes for store.foodLogs, for the same reason.
  useEffectMd(() => {
    mdAutoFillToday(store, setStore, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.medicationScheduleSlots, store.medications, today]);

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
    curDateLogs.forEach(e => {
      const h = parseInt((e.time || '0:00').split(':')[0], 10) || 0;
      (map[h] = map[h] || []).push(e);
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
      if (!mdSlotAppliesOn(slot, curDate, wd, activePlanIds)) return;
      (map[slot.hour] = map[slot.hour] || []).push({
        id: `preview_${curDate}_${slot.id}`, medicationId: med.id, medicationName: med.name,
        time: `${String(slot.hour).padStart(2, '0')}:00`, doseQty: slot.doseQty, planned: true,
        scheduleSlotId: slot.id, isPreview: true,
      });
    });
    Object.keys(map).forEach(h => map[h].sort((a, b) => (a.time || '').localeCompare(b.time || '')));
    return map;
    // medicationPlans is a real dependency, not just an incidental read: an
    // active/inactive toggle must immediately reflect here, otherwise
    // pausing/resuming a plan would silently wait for some unrelated
    // re-render before the Timeline's preview rows caught up.
  }, [curDateLogs, curDate, activeMedications, scheduleSlots, medicationPlans]);
  function toggleTaken(entry) {
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).map(l => l.id === entry.id ? { ...l, planned: !l.planned } : l) }));
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
    const entry = { id: LB.uid(), medicationId: med.id, medicationName: med.name, date: curDate, time, doseQty: qty, planned: false, scheduleSlotId: null };
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
  const plans = useMemoMd(() => medicationPlans.filter(p => !p.archived && inBucket(p)), [medicationPlans, isCoach, planSubTab]);
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
    () => medications.filter(m => !m.archived && viewedPlanMedIds.has(m.id)),
    [medications, viewedPlanMedIds],
  );

  // "Add medication" from within a plan: pick an existing medication not
  // already a member of THIS plan (any medication is eligible, whether or
  // not it's already a member of some other plan, see the header comment),
  // or jump into medSheet to create a brand new one. Attaching only ever
  // inserts a membership row, it never creates the medication itself, so a
  // plan's own "Add medication" is always a picker, never a create form.
  const [addToPlanOpen, setAddToPlanOpen] = useStateMd(false);
  const availableToAddMeds = useMemoMd(
    () => activeMedications.filter(m => !viewedPlanMedIds.has(m.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [activeMedications, viewedPlanMedIds],
  );
  function attachMedicationToPlan(med) {
    setStore(s => ({
      ...s,
      medicationPlanItems: [...(s.medicationPlanItems || []), { id: LB.uid(), medicationPlanId: viewedPlanId, medicationId: med.id, createdAt: new Date().toISOString() }],
    }));
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
      ? relevantSlots.map(sl => `${sl.weekdays.length === 7 ? 'Every day' : sl.weekdays.map(w => MD_WEEKDAY_SHORT[w]).join('/')} ${String(sl.hour).padStart(2, '0')}:00 · ${mdFmtQty(sl.doseQty, m.unitLabel)}`).join('; ')
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
  // Only an active plan's schedule slots fire (mdSlotAppliesOn); several
  // plans can be active at once, no single active pointer (see the header
  // comment). A paused plan stays fully visible/editable, this never
  // touches its medications or their memberships/slots, purely a switch.
  function togglePlanActive(plan) {
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === plan.id ? { ...p, active: !p.active, updatedAt: new Date().toISOString() } : p) }));
  }
  async function deletePlan(plan) {
    // Only this plan's own membership rows and schedule slots go: a
    // medication itself, its OTHER plans' memberships/schedules, and its
    // log history are all untouched, same non-destructive reasoning as
    // removeMedicationFromPlan (this is that same operation, just for
    // every medication currently in the plan at once).
    if (!await confirm(`Delete "${plan.name}"? Its medications stay in your Medications list (and any other plans they're in), just this plan's own schedule for them goes.`, { title: 'Delete plan', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({
      ...s,
      medicationPlans: (s.medicationPlans || []).filter(p => p.id !== plan.id),
      medicationPlanItems: (s.medicationPlanItems || []).filter(it => it.medicationPlanId !== plan.id),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.medicationPlanId !== plan.id),
    }));
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
    });
  }
  // Every plan this medication currently belongs to, for medSheet's own
  // membership list below (a medication can be in several plans at once,
  // see the header comment).
  const medSheetMemberships = useMemoMd(
    () => medSheet?.id ? medicationPlanItems.filter(it => it.medicationId === medSheet.id) : [],
    [medicationPlanItems, medSheet?.id],
  );
  // A medication is only ever created with zero plan memberships: creating
  // one lives exclusively in the Inventory tab's Medications sub-tab, a
  // plan's own "Add medication" only ever attaches an existing one (see
  // attachMedicationToPlan), never creates a fresh one.
  function openMedSheet(med) {
    const next = med ? {
      id: med.id, name: med.name, brand: med.brand || '', category: med.category || '',
      unitLabel: med.unitLabel || 'pills', packageSizeStr: med.packageSize ? String(med.packageSize) : '',
    } : {
      id: null, name: '', brand: '', category: '', unitLabel: 'pills', packageSizeStr: '',
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
      setStore(s => ({
        ...s,
        medications: (s.medications || []).map(m => m.id !== medSheet.id ? m : {
          ...m, name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
          category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills',
          packageSize, updatedAt: nowISO,
        }),
      }));
    } else {
      const newMed = {
        id: LB.uid(), name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
        category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills', packageSize,
        stockBaseline: null, stockSetAt: null, archived: false, createdAt: nowISO, updatedAt: nowISO,
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
  // confirm like Delete does. Doesn't close medSheet: it now shows a list
  // of memberships, removing one should leave the sheet open on the rest.
  async function removeMedicationFromPlan(med, planId) {
    const planName = medicationPlans.find(p => p.id === planId)?.name || 'this plan';
    if (!await confirm(`Remove "${med.name}" from "${planName}"? Its schedule in this plan goes with it; the medication itself, any other plans it's in, and its log history all stay.`, { title: 'Remove from plan', ok: 'Remove', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({
      ...s,
      medicationPlanItems: (s.medicationPlanItems || []).filter(it => !(it.medicationId === med.id && it.medicationPlanId === planId)),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => !(sl.medicationId === med.id && sl.medicationPlanId === planId)),
    }));
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
  const [slotDraft, setSlotDraft] = useStateMd(null); // { id: null|id, weekdays, hour, doseQtyStr, phaseOpen, startDate, endDate }
  const slotDraftInitialSnap = useRefMd(null);
  function snapSlotDraft(d) {
    return JSON.stringify({ weekdays: d.weekdays, hour: d.hour, doseQtyStr: d.doseQtyStr, phaseOpen: d.phaseOpen, startDate: d.startDate, endDate: d.endDate });
  }
  function openSlotDraft(slot) {
    const next = slot ? {
      id: slot.id, weekdays: [...(slot.weekdays || [])], hour: slot.hour, doseQtyStr: String(slot.doseQty ?? ''),
      phaseOpen: !!(slot.startDate || slot.endDate), startDate: slot.startDate || '', endDate: slot.endDate || '',
    } : {
      // Starts with NO days selected (was all 7): a blank slate reads more
      // honestly as "pick what you actually mean" than a default that
      // happens to already be right only for an every-day dose.
      // selectAllWeekdays below is the one-tap shortcut for that common case.
      id: null, weekdays: [], hour: 8, doseQtyStr: '',
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
    if (!schedMed?.id || !schedMed.medicationPlanId || !slotDraft || !slotDraft.weekdays.length) return;
    const doseQty = mdNum(slotDraft.doseQtyStr);
    if (!(doseQty > 0)) return;
    const nowISO = new Date().toISOString();
    // Gated on the fields' own values, NOT on phaseOpen: phaseOpen only
    // controls whether the date-range section is visually expanded.
    // Collapsing it to declutter the sheet must not silently wipe a
    // staged cycle's dates, only actually clearing the inputs should.
    const startDate = slotDraft.startDate || null;
    const endDate = slotDraft.endDate || null;
    if (slotDraft.id) {
      setStore(s => ({
        ...s,
        medicationScheduleSlots: (s.medicationScheduleSlots || []).map(sl => sl.id !== slotDraft.id ? sl : {
          ...sl, weekdays: slotDraft.weekdays, hour: slotDraft.hour, doseQty,
          startDate, endDate, updatedAt: nowISO,
        }),
      }));
    } else {
      const newSlot = {
        id: LB.uid(), medicationId: schedMed.id, medicationPlanId: schedMed.medicationPlanId,
        weekdays: slotDraft.weekdays, hour: slotDraft.hour,
        doseQty, startDate, endDate, createdAt: nowISO, updatedAt: nowISO,
      };
      setStore(s => ({ ...s, medicationScheduleSlots: [...(s.medicationScheduleSlots || []), newSlot] }));
    }
    setSlotDraft(null);
  }
  function deleteSlot(slot) {
    setStore(s => ({ ...s, medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.id !== slot.id) }));
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
  const [invSubTab, setInvSubTab] = useStateMd('inventory'); // 'inventory' | 'medications'
  const inventoryList = useMemoMd(
    () => [...activeMedications].sort((a, b) => a.name.localeCompare(b.name)),
    [activeMedications],
  );
  const lowStockList = useMemoMd(
    () => inventoryList.filter(m => mdIsLowStock(m, mdEffectiveStock(m, medicationLogs, today))),
    [inventoryList, medicationLogs, today],
  );
  const [lowStockAcks, setLowStockAcks] = useStateMd(mdReadLowStockAcks);
  const freshLowStock = useMemoMd(
    () => lowStockList.filter(m => lowStockAcks[m.id] !== m.stockSetAt),
    [lowStockList, lowStockAcks],
  );
  function dismissLowStockBanner() {
    const next = { ...lowStockAcks };
    freshLowStock.forEach(m => { next[m.id] = m.stockSetAt; });
    setLowStockAcks(next);
    mdWriteLowStockAcks(next);
  }

  // Filter for the main list below Running Low: All / Tracked (has a stock
  // count) / Not tracked. Never applies to Running Low itself, being low
  // stock definitionally requires a real count to compare against package
  // size, so that section is always "Tracked" anyway.
  const [invStockFilter, setInvStockFilter] = useStateMd('all'); // 'all' | 'tracked' | 'untracked'
  const mainInventoryList = useMemoMd(() => {
    const rest = inventoryList.filter(m => !mdIsLowStock(m, mdEffectiveStock(m, medicationLogs, today)));
    if (invStockFilter === 'all') return rest;
    return rest.filter(m => {
      const tracked = mdEffectiveStock(m, medicationLogs, today) != null;
      return invStockFilter === 'tracked' ? tracked : !tracked;
    });
  }, [inventoryList, medicationLogs, today, invStockFilter]);

  // Tapping a row here only ever updates stock, never identity/category/
  // schedule: those live behind the Schedule tab's own medication sheet, on
  // purpose, so Inventory stays a single-purpose "how much is left" screen.
  const [stockSheet, setStockSheet] = useStateMd(null); // { id, name, unitLabel, stockStr } | null
  function openStockSheet(med) {
    setStockSheet({ id: med.id, name: med.name, unitLabel: med.unitLabel || 'pills', stockStr: '' });
  }
  function saveStockSheet() {
    if (!stockSheet) return;
    const stockTyped = mdNum(stockSheet.stockStr);
    if (stockTyped != null) {
      const nowISO = new Date().toISOString();
      setStore(s => ({
        ...s,
        medications: (s.medications || []).map(m => m.id !== stockSheet.id ? m : { ...m, stockBaseline: stockTyped, stockSetAt: nowISO, updatedAt: nowISO }),
      }));
    }
    setStockSheet(null);
  }

  // Stock is the headline here, package size the quiet caption, same
  // prominence swap as the Food Shopping List's own Inventory row
  // (fdBuildInventoryList/renderShoppingRow, screens-food.jsx): without a
  // real buy-quantity estimate to show, the number worth a glance is how
  // much is actually left, not the static per-pack fact.
  function renderMedRow(med) {
    const effectiveStock = mdEffectiveStock(med, medicationLogs, today);
    const low = mdIsLowStock(med, effectiveStock);
    return (
      <button key={med.id} onClick={() => openStockSheet(med)} style={{ ...mdQuickRowInner, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ ...mdEntryName, minWidth: 0 }}>{med.name}</div>
            {med.category && <Pill gold>{mdCategoryLabel(med.category)}</Pill>}
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

  if (!store) return null;
  return (
    <Screen>
      <TopBar title="Medications" onBack={() => go({ name: 'home' })} right={
        screenTab === 'timeline' && (
          <button onClick={() => openLogSheet()} aria-label="Log a dose" style={mdTopAddBtn} disabled={!activeMedications.length}>
            <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
          </button>
        )
      } />
      {confirmEl}
      <SubTabBar tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'schedule', label: 'Schedule' }, { id: 'inventory', label: 'Inventory' }]} active={screenTab} onChange={setScreenTab} />

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {screenTab === 'timeline' && (
          <>
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
                {Array.from({ length: 24 }, (_, h) => h).map(h => {
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
                        <button onClick={() => openLogSheet(h)} aria-label={`Log a dose at ${String(h).padStart(2, '0')}:00`} style={mdHourAddBtn(isNow)} disabled={!activeMedications.length}>
                          <i className="fa-solid fa-plus" style={{ fontSize: 11 }} />
                        </button>
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
                <Btn onClick={() => setAddToPlanOpen(true)} style={{ flex: 1 }}>
                  <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add medication
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
            <SubTabBar tabs={[{ id: 'medications', label: 'Medications' }, { id: 'inventory', label: 'Inventory' }]} active={invSubTab} onChange={setInvSubTab} style={{ padding: 0, marginBottom: 4 }} />
            {invSubTab === 'inventory' ? (
              <>
                {freshLowStock.length > 0 && (
                  <div style={{ background: 'rgba(var(--warn-rgb),0.14)', border: '1px solid rgba(var(--warn-rgb),0.45)', borderRadius: 6, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 15, color: 'var(--warn)', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                      {freshLowStock.length === 1 ? `${freshLowStock[0].name} is running low.` : `${freshLowStock.length} medications are running low.`}
                    </div>
                    <button onClick={dismissLowStockBanner} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
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
                    <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}` }}>
                      {[{ id: 'all', label: 'All' }, { id: 'tracked', label: 'Tracked' }, { id: 'untracked', label: 'Not tracked' }].map(f => (
                        <button key={f.id} onClick={() => setInvStockFilter(f.id)} style={mdSegBtn(invStockFilter === f.id)}>{f.label}</button>
                      ))}
                    </div>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {inventoryList.map(m => renderMedListRow(m, { showPlanTag: true }))}
                  </div>
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
            {mdEffectiveStock(medications.find(m => m.id === stockSheet.id) || {}, medicationLogs, today) != null && (
              <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 12 }}>
                Current stock: <span className="num">{mdFmtQty(mdEffectiveStock(medications.find(m => m.id === stockSheet.id), medicationLogs, today), stockSheet.unitLabel)}</span>
              </div>
            )}
            <Field label={`Update stock (${stockSheet.unitLabel || 'pills'})`} style={{ marginBottom: 6 }}>
              <input value={stockSheet.stockStr} onChange={e => setStockSheet(d => ({ ...d, stockStr: mdDecimalFilter(e.target.value) }))}
                type="text" inputMode="decimal" placeholder="e.g. 60 after restocking" style={mdInputStyle} autoFocus />
            </Field>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '16px' }}>
              Tracks what's actually taken since, warns here once it drops below a package. Leave blank to keep the current count unchanged.
            </div>
            <Btn onClick={saveStockSheet} style={{ width: '100%' }}>Save</Btn>
          </>
        )}
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

      {/* Add an existing medication (from anywhere, whether or not it's
          already in some other plan too) to the viewed plan. Creating a new
          medication only ever happens in the Inventory tab's Medications
          sub-tab, never from here (see openMedSheet). */}
      <Sheet open={addToPlanOpen} onClose={() => setAddToPlanOpen(false)} title="Add medication" titleColor="var(--accent)">
        {availableToAddMeds.length === 0 ? (
          <div style={mdEmptyHint}>Every medication you have is already in this plan. Create a new one in the Medications tab first.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {availableToAddMeds.map(m => (
              <button key={m.id} onClick={() => { attachMedicationToPlan(m); setAddToPlanOpen(false); }} style={{ ...mdQuickRowInner, display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}>
                <span style={mdEntryName}>{m.name}</span>
                <i className="fa-solid fa-plus" style={{ fontSize: 12, color: 'var(--accent)' }} />
              </button>
            ))}
          </div>
        )}
      </Sheet>

      {/* Edit / create a medication: identity only (name, brand, category,
          unit, package size), see the header comment's split. Schedule
          editing for an existing medication lives in the separate schedMed
          Sheet below instead, never here. */}
      <Sheet open={!!medSheet} onClose={requestCloseMedSheet} title={medSheet?.id ? 'Edit medication' : 'Add medication'} titleColor="var(--accent)">
        {medSheet && (
          <>
            <Field label="Name" style={{ marginBottom: 14 }}>
              <TextInput value={medSheet.name} onChange={v => setMedSheet(d => ({ ...d, name: v }))} placeholder="e.g. Vitamin D3" autoFocus />
            </Field>
            <Field label="Brand (optional)" style={{ marginBottom: 14 }}>
              <TextInput value={medSheet.brand} onChange={v => setMedSheet(d => ({ ...d, brand: v }))} placeholder="e.g. Nature's Own" />
            </Field>
            <div className="micro" style={{ marginBottom: 6 }}>Category</div>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 14 }}>
              {MED_CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setMedSheet(d => ({ ...d, category: d.category === c.id ? '' : c.id }))} style={mdSegBtn(medSheet.category === c.id)}>{c.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <Field label="Unit" style={{ flex: 1, marginBottom: 0 }}>
                <TextInput value={medSheet.unitLabel} onChange={v => setMedSheet(d => ({ ...d, unitLabel: v }))} placeholder="pills" />
              </Field>
              <Field label="Package size" style={{ flex: 1, marginBottom: 0 }}>
                <input value={medSheet.packageSizeStr} onChange={e => setMedSheet(d => ({ ...d, packageSizeStr: mdDecimalFilter(e.target.value) }))}
                  type="text" inputMode="decimal" placeholder="e.g. 60" style={mdInputStyle} />
              </Field>
            </div>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: -8, marginBottom: 14, lineHeight: '16px' }}>
              Total amount in one container (e.g. a whole vial or bottle), not the dose. A vial labeled "250mg/ml" at 10ml holds 2500mg total. Dose is set separately per scheduled time.
            </div>
            {medSheet.id && medSheetMemberships.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="micro" style={{ marginBottom: 8 }}>In these plans</div>
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
      <Sheet open={!!schedMed && !slotDraft} onClose={closeSchedMed} title={schedMed?.name || 'Schedule'} titleColor="var(--accent)">
        {schedMed && (
          <>
            {schedMedSlots.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {schedMedSlots.map(sl => (
                  <div key={sl.id} style={{ ...mdQuickRowInner, cursor: 'default' }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>
                      {sl.weekdays.length === 7 ? 'Every day' : sl.weekdays.map(w => MD_WEEKDAY_SHORT[w]).join('/')} {String(sl.hour).padStart(2, '0')}:00 · {mdFmtQty(sl.doseQty, schedMed.unitLabel)}
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

      {/* Add/edit one schedule slot, nested within the schedMed sheet above */}
      <Sheet open={!!slotDraft} onClose={requestCloseSlotDraft} title={slotDraft?.id ? 'Edit time' : 'Add time'} titleColor="var(--accent)">
        {slotDraft && (
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
            <div className="micro" style={{ marginBottom: 6 }}>Time</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Stepper value={slotDraft.hour} step={1} min={0} max={23} suffix=":00" onChange={v => setSlotDraft(d => ({ ...d, hour: Math.max(0, Math.min(23, Math.round(v))) }))} big />
            </div>
            <Field label={`Dose (${schedMed?.unitLabel || 'pills'})`} style={{ marginBottom: 14 }}>
              <input value={slotDraft.doseQtyStr} onChange={e => setSlotDraft(d => ({ ...d, doseQtyStr: mdDecimalFilter(e.target.value) }))}
                type="text" inputMode="decimal" placeholder="e.g. 1" style={mdInputStyle} autoFocus />
            </Field>
            <button onClick={() => setSlotDraft(d => ({ ...d, phaseOpen: !d.phaseOpen }))} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11, fontFamily: UI.fontUi, cursor: 'pointer', marginBottom: slotDraft.phaseOpen ? 10 : 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className={`fa-solid fa-chevron-${slotDraft.phaseOpen ? 'down' : 'right'}`} style={{ fontSize: 9 }} />
              Limit to a date range (for a staged cycle)
            </button>
            {slotDraft.phaseOpen && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <Field label="From" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="date" value={slotDraft.startDate} onChange={e => setSlotDraft(d => ({ ...d, startDate: e.target.value }))} style={mdInputStyle} />
                </Field>
                <Field label="To" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="date" value={slotDraft.endDate} onChange={e => setSlotDraft(d => ({ ...d, endDate: e.target.value }))} style={mdInputStyle} />
                </Field>
              </div>
            )}
            <Btn onClick={saveSlotDraft} disabled={!slotDraft.weekdays.length || !mdNum(slotDraft.doseQtyStr)} style={{ width: '100%' }}>Save</Btn>
          </>
        )}
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
    </Screen>
  );
}

Object.assign(window.Screens, { MedicationsScreen });
