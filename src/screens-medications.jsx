/* Medications tracker: a personal (optionally coach-managed) log/schedule/
   inventory system for medications, vitamins and supplements, modeled closely
   on the Food Tracker's Plan Mode (zane_food_meal_plans/zane_food_template_
   slots/zane_food_logs, see screens-food.jsx) but with its own weekday-based
   schedule (not tied to training/rest day type) and its own inventory unit
   (unit_label, not always grams).

   Three tabs:
   - Timeline: today's doses (auto-filled from active schedule slots, same
     planned/logged distinction as food), plus logging an ad-hoc dose.
   - Schedule: named plans (My Plans / Client Templates for a coach, like
     FoodTemplateScreen), each holding medications, each medication holding
     its own recurring weekly schedule slot(s).
   - Inventory: every non-archived medication (not just stock-tracked ones,
     unlike the Shopping List's own Inventory tab: this domain's medication
     list IS the inventory, there's no separate frequency-filtered "staple"
     concept sitting in front of it), with a Running Low section for anything
     that's dipped under its package size.

   Multiple plans run concurrently on purpose (no active_*_id pointer like
   food): daily vitamins alongside a coach-prescribed cycle is the normal
   case, not an either/or. See zane_medication_plans in docs/database.md.

   Coach access mirrors the Food Tracker's meal-plan push exactly
   (LB.pushMedicationPlanToClient, store.js): coach-of-client RLS gives full
   read/write on all four tables, a coach VIEWS a client's medications via its
   own direct query (ClientMedicationsTab, screens-coaching-detail.jsx), same
   split as ClientNutritionTab/pushMealPlanToClient. */

const { useState: useStateMd, useEffect: useEffectMd, useMemo: useMemoMd } = React;

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

// ── Constants ──
// Free text on zane_medications.category (no DB CHECK), these are just the
// UI's own presets, a new category never needs a migration.
const MED_CATEGORIES = [
  { id: 'vitamin', label: 'Vitamin' },
  { id: 'supplement', label: 'Supplement' },
  { id: 'compound', label: 'Compound' },
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

// A schedule slot applies to `dateISO` if it's active, today's weekday is in
// its list, and (when set) dateISO falls inside its optional start/end date
// phase. Both bounds null (the default) means unbounded, identical to a plain
// always-on schedule.
function mdSlotAppliesOn(slot, dateISO, wd) {
  if (!slot.active) return false;
  if (!(slot.weekdays || []).includes(wd)) return false;
  if (slot.startDate && dateISO < slot.startDate) return false;
  if (slot.endDate && dateISO > slot.endDate) return false;
  return true;
}
function mdMaterializeSlotEntry(med, slot, dateISO) {
  return {
    id: LB.uid(), medicationId: med.id, medicationName: med.name,
    date: dateISO, time: `${String(slot.hour).padStart(2, '0')}:00`,
    doseQty: slot.doseQty, planned: true, scheduleSlotId: slot.id,
  };
}
// Fills in today's due-but-missing doses from active schedule slots, same
// idea as the Food Tracker's own auto-fill effect. Checks scheduleSlotId
// against today's existing log rows (not just count) so a slot that already
// materialized isn't duplicated; a deliberately-deleted entry can reappear on
// a fresh boot (no zane_food_template_days-style cross-device marker for
// this yet), an accepted v1 rough edge, not a correctness bug: at worst you
// see a stray "still due" row you can mark taken or ignore.
function mdAutoFillToday(store, setStore, todayISO) {
  const wd = LB.isoWd(new Date());
  const medsById = new Map((store.medications || []).filter(m => !m.archived).map(m => [m.id, m]));
  const existingSlotIds = new Set(
    (store.medicationLogs || []).filter(l => l.date === todayISO && l.scheduleSlotId).map(l => l.scheduleSlotId)
  );
  const toAdd = [];
  (store.medicationScheduleSlots || []).forEach(slot => {
    const med = medsById.get(slot.medicationId);
    if (!med || existingSlotIds.has(slot.id)) return;
    if (!mdSlotAppliesOn(slot, todayISO, wd)) return;
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

  const isCoach = (store.coaching?.asCoach || []).some(c => c.status === 'active');
  const coachClients = useMemoMd(() => (store.coaching?.asCoach || []).filter(c => c.status === 'active'), [store.coaching]);

  // Auto-fill today's due doses. Gated on the collections it reads plus
  // `today`, same dependency shape as the Food Tracker's own fill effect.
  useEffectMd(() => {
    mdAutoFillToday(store, setStore, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.medicationScheduleSlots, store.medications, store.medicationLogs, today]);

  // ─────────────────────────── Timeline tab ───────────────────────────
  const todaysLogs = useMemoMd(
    () => medicationLogs.filter(l => l.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [medicationLogs, today],
  );
  function toggleTaken(entry) {
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).map(l => l.id === entry.id ? { ...l, planned: !l.planned } : l) }));
  }
  async function deleteLogEntry(entry) {
    if (!await confirm('Remove this entry from today’s timeline?', { title: 'Delete entry', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    setStore(s => ({ ...s, medicationLogs: (s.medicationLogs || []).filter(l => l.id !== entry.id) }));
  }

  const [logDraft, setLogDraft] = useStateMd(null); // { medicationId, doseQtyStr } | null
  function openLogSheet() {
    setLogDraft({ medicationId: activeMedications[0]?.id || '', doseQtyStr: '' });
  }
  function saveLogDraft() {
    const med = medications.find(m => m.id === logDraft?.medicationId);
    const qty = mdNum(logDraft?.doseQtyStr);
    if (!med || !(qty > 0)) return;
    const entry = { id: LB.uid(), medicationId: med.id, medicationName: med.name, date: today, time: LB.nowHHMM(), doseQty: qty, planned: false, scheduleSlotId: null };
    setStore(s => ({ ...s, medicationLogs: [...(s.medicationLogs || []), entry] }));
    setLogDraft(null);
  }

  // ─────────────────────────── Schedule tab ───────────────────────────
  const [planSubTab, setPlanSubTab] = useStateMd('mine'); // 'mine' | 'templates', coach bucket only
  const inBucket = p => !isCoach || (planSubTab === 'templates' ? !!p.isTemplate : !p.isTemplate);
  const plans = useMemoMd(() => medicationPlans.filter(p => !p.archived && inBucket(p)), [medicationPlans, isCoach, planSubTab]);
  const [viewedPlanId, setViewedPlanId] = useStateMd(null);
  useEffectMd(() => {
    if (viewedPlanId && !plans.some(p => p.id === viewedPlanId)) setViewedPlanId(null);
  }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewedPlan = plans.find(p => p.id === viewedPlanId) || null;
  const viewedPlanMeds = useMemoMd(
    () => medications.filter(m => !m.archived && m.medicationPlanId === viewedPlanId),
    [medications, viewedPlanId],
  );

  const [planNameDraft, setPlanNameDraft] = useStateMd(null); // { id: null|id, name }
  function createPlan(name) {
    const id = LB.uid();
    const nowISO = new Date().toISOString();
    const asTemplate = isCoach && planSubTab === 'templates';
    setStore(s => ({
      ...s,
      medicationPlans: [{ id, name: (name || '').trim() || 'Medications', archived: false, isTemplate: asTemplate, coachId: null, createdAt: nowISO, updatedAt: nowISO }, ...(s.medicationPlans || [])],
    }));
    setViewedPlanId(id);
  }
  function renamePlan(id, name) {
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === id ? { ...p, name: (name || '').trim() || p.name, updatedAt: new Date().toISOString() } : p) }));
  }
  async function deletePlan(plan) {
    if (!await confirm(`Delete "${plan.name}" and every medication in it?`, { title: 'Delete plan', ok: 'Delete', cancel: 'Cancel', danger: true })) return;
    const medIds = new Set(medications.filter(m => m.medicationPlanId === plan.id).map(m => m.id));
    setStore(s => ({
      ...s,
      medicationPlans: (s.medicationPlans || []).filter(p => p.id !== plan.id),
      medications: (s.medications || []).filter(m => m.medicationPlanId !== plan.id),
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => !medIds.has(sl.medicationId)),
    }));
    setViewedPlanId(null);
  }
  function toggleTemplate(plan) {
    setStore(s => ({ ...s, medicationPlans: (s.medicationPlans || []).map(p => p.id === plan.id ? { ...p, isTemplate: !p.isTemplate, updatedAt: new Date().toISOString() } : p) }));
  }

  // Medication identity + inventory edit sheet. draft.id === null means
  // "creating a new medication in viewedPlanId".
  const [medSheet, setMedSheet] = useStateMd(null);
  function openMedSheet(med) {
    setMedSheet(med ? {
      id: med.id, name: med.name, brand: med.brand || '', category: med.category || '',
      unitLabel: med.unitLabel || 'pills', packageSizeStr: med.packageSize ? String(med.packageSize) : '',
      stockStr: '',
    } : {
      id: null, name: '', brand: '', category: '', unitLabel: 'pills', packageSizeStr: '', stockStr: '',
    });
  }
  function closeMedSheet() { setMedSheet(null); }
  function saveMedSheet() {
    if (!medSheet || !medSheet.name.trim()) return;
    const packageSize = mdNum(medSheet.packageSizeStr);
    const stockTyped = mdNum(medSheet.stockStr);
    const nowISO = new Date().toISOString();
    if (medSheet.id) {
      setStore(s => ({
        ...s,
        medications: (s.medications || []).map(m => m.id !== medSheet.id ? m : {
          ...m, name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
          category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills',
          packageSize, updatedAt: nowISO,
          ...(stockTyped != null ? { stockBaseline: stockTyped, stockSetAt: nowISO } : {}),
        }),
      }));
    } else {
      const planId = viewedPlanId;
      if (!planId) return;
      const newMed = {
        id: LB.uid(), medicationPlanId: planId, name: medSheet.name.trim(), brand: medSheet.brand.trim() || null,
        category: medSheet.category || null, unitLabel: medSheet.unitLabel.trim() || 'pills', packageSize,
        stockBaseline: stockTyped, stockSetAt: stockTyped != null ? nowISO : null,
        archived: false, createdAt: nowISO, updatedAt: nowISO,
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
      medicationScheduleSlots: (s.medicationScheduleSlots || []).filter(sl => sl.medicationId !== med.id),
    }));
    closeMedSheet();
  }

  // Schedule slots for the medication currently open in medSheet.
  const medSheetSlots = useMemoMd(
    () => medSheet?.id ? scheduleSlots.filter(sl => sl.medicationId === medSheet.id) : [],
    [scheduleSlots, medSheet?.id],
  );
  const [slotDraft, setSlotDraft] = useStateMd(null); // { id: null|id, weekdays, hour, doseQtyStr, active, phaseOpen, startDate, endDate }
  function openSlotDraft(slot) {
    setSlotDraft(slot ? {
      id: slot.id, weekdays: [...(slot.weekdays || [])], hour: slot.hour, doseQtyStr: String(slot.doseQty ?? ''),
      active: slot.active, phaseOpen: !!(slot.startDate || slot.endDate), startDate: slot.startDate || '', endDate: slot.endDate || '',
    } : {
      id: null, weekdays: [...MD_WEEKDAYS_EVERY_DAY], hour: 8, doseQtyStr: '', active: true,
      phaseOpen: false, startDate: '', endDate: '',
    });
  }
  function saveSlotDraft() {
    if (!medSheet?.id || !slotDraft || !slotDraft.weekdays.length) return;
    const doseQty = mdNum(slotDraft.doseQtyStr);
    if (!(doseQty > 0)) return;
    const nowISO = new Date().toISOString();
    const startDate = slotDraft.phaseOpen && slotDraft.startDate ? slotDraft.startDate : null;
    const endDate = slotDraft.phaseOpen && slotDraft.endDate ? slotDraft.endDate : null;
    if (slotDraft.id) {
      setStore(s => ({
        ...s,
        medicationScheduleSlots: (s.medicationScheduleSlots || []).map(sl => sl.id !== slotDraft.id ? sl : {
          ...sl, weekdays: slotDraft.weekdays, hour: slotDraft.hour, doseQty, active: slotDraft.active,
          startDate, endDate, updatedAt: nowISO,
        }),
      }));
    } else {
      const newSlot = {
        id: LB.uid(), medicationId: medSheet.id, weekdays: slotDraft.weekdays, hour: slotDraft.hour,
        doseQty, active: true, startDate, endDate, createdAt: nowISO, updatedAt: nowISO,
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
      const planMeds = medications.filter(m => m.medicationPlanId === pushPlan.id);
      const medIds = new Set(planMeds.map(m => m.id));
      await LB.pushMedicationPlanToClient({
        plan: pushPlan, medications: planMeds,
        scheduleSlots: scheduleSlots.filter(sl => medIds.has(sl.medicationId)),
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

  function renderMedRow(med) {
    const effectiveStock = mdEffectiveStock(med, medicationLogs, today);
    const low = mdIsLowStock(med, effectiveStock);
    return (
      <button key={med.id} onClick={() => openMedSheet(med)} style={{ ...mdQuickRowInner, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ ...mdEntryName, minWidth: 0 }}>{med.name}</div>
            {med.category && <Pill gold>{mdCategoryLabel(med.category)}</Pill>}
          </div>
          {effectiveStock != null
            ? <div style={{ fontSize: 10, color: low ? 'var(--warn)' : UI.inkFaint, fontFamily: UI.fontUi }}>
                {mdFmtQty(effectiveStock, med.unitLabel)} {low ? 'left' : 'in stock'}
              </div>
            : (med.brand ? <div style={mdEntryMeta}>{med.brand}</div> : <div style={mdEntryMeta}>Not tracked</div>)}
        </div>
        {med.packageSize > 0 && (
          <div className="num" style={{ fontSize: 11, color: UI.inkFaint, flexShrink: 0 }}>{mdFmtQty(med.packageSize, med.unitLabel)}/pack</div>
        )}
      </button>
    );
  }

  if (!store) return null;
  return (
    <Screen>
      <TopBar title="Medications" onBack={() => go({ name: 'home' })} right={
        screenTab === 'timeline' && (
          <button onClick={openLogSheet} aria-label="Log a dose" style={mdTopAddBtn} disabled={!activeMedications.length}>
            <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
          </button>
        )
      } />
      {confirmEl}
      <SubTabBar tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'schedule', label: 'Schedule' }, { id: 'inventory', label: 'Inventory' }]} active={screenTab} onChange={setScreenTab} />

      <div style={{ padding: '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {screenTab === 'timeline' && (
          !todaysLogs.length ? (
            <Empty title="Nothing today" sub="Set up a schedule, or log a dose right now."
              icon={<i className="fa-solid fa-pills" style={{ fontSize: 28, color: UI.inkFaint }} />} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todaysLogs.map(entry => (
                <div key={entry.id} style={{ ...mdQuickRowInner, cursor: 'default', opacity: entry.planned ? 1 : 0.7 }}>
                  <MdCheckbox checked={!entry.planned} onToggle={() => toggleTaken(entry)} label={entry.planned ? 'Mark as taken' : 'Mark as not taken'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={mdEntryName}>{entry.medicationName}</div>
                    <div style={mdEntryMeta}>{entry.time} · {mdFmtQty(entry.doseQty, medications.find(m => m.id === entry.medicationId)?.unitLabel)}</div>
                  </div>
                  <button onClick={() => deleteLogEntry(entry)} aria-label="Delete entry" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, WebkitTapHighlightColor: 'transparent' }}>
                    <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} />
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {screenTab === 'schedule' && (
          !viewedPlan ? (
            <>
              {isCoach && <SubTabBar tabs={[{ id: 'mine', label: 'My Plans' }, { id: 'templates', label: 'Client Templates' }]} active={planSubTab} onChange={setPlanSubTab} style={{ padding: 0, marginBottom: 4 }} />}
              <Btn onClick={() => setPlanNameDraft({ id: null, name: '' })} style={{ width: '100%' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> New plan
              </Btn>
              {!plans.length ? (
                <Empty title="No plans yet" sub="A plan groups medications you take for the same reason, vitamins, a cycle, whatever makes sense to you."
                  icon={<i className="fa-solid fa-folder-open" style={{ fontSize: 28, color: UI.inkFaint }} />} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {plans.map(p => (
                    <button key={p.id} onClick={() => setViewedPlanId(p.id)} style={{ ...mdQuickRowInner, display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}>
                      <span style={mdEntryName}>{p.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={mdEntryMeta}>{medications.filter(m => !m.archived && m.medicationPlanId === p.id).length}</span>
                        <i className="fa-solid fa-chevron-right" style={{ fontSize: 12, color: UI.inkFaint }} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <button onClick={() => setViewedPlanId(null)} style={{ background: 'none', border: 'none', color: UI.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} /> Plans
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isCoach && <button className="label" onClick={() => setCoachMenuOpen(true)} style={mdEditBtn}>Coach</button>}
                  <button className="label" onClick={() => setPlanNameDraft({ id: viewedPlan.id, name: viewedPlan.name })} style={mdEditBtn}>Rename</button>
                </div>
              </div>
              <div className="display" style={{ fontSize: 20, color: UI.ink }}>{viewedPlan.name}</div>
              <Btn onClick={() => openMedSheet(null)} style={{ width: '100%' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Add medication
              </Btn>
              {!viewedPlanMeds.length ? (
                <Empty title="Nothing in this plan yet" sub="Add a medication, then give it a weekly schedule."
                  icon={<i className="fa-solid fa-pills" style={{ fontSize: 28, color: UI.inkFaint }} />} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {viewedPlanMeds.map(m => (
                    <button key={m.id} onClick={() => openMedSheet(m)} style={{ ...mdQuickRowInner, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={mdEntryName}>{m.name}</span>
                        {m.category && <Pill gold>{mdCategoryLabel(m.category)}</Pill>}
                      </div>
                      <div style={mdEntryMeta}>
                        {scheduleSlots.filter(sl => sl.medicationId === m.id && sl.active).length
                          ? scheduleSlots.filter(sl => sl.medicationId === m.id && sl.active).map(sl =>
                              `${sl.weekdays.length === 7 ? 'Every day' : sl.weekdays.map(w => MD_WEEKDAY_SHORT[w]).join('/')} ${String(sl.hour).padStart(2, '0')}:00 · ${mdFmtQty(sl.doseQty, m.unitLabel)}`
                            ).join('; ')
                          : 'No schedule yet'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )
        )}

        {screenTab === 'inventory' && (
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
              <Empty title="No medications yet" sub="Add one from the Schedule tab to start tracking it here."
                icon={<i className="fa-solid fa-box-open" style={{ fontSize: 28, color: UI.inkFaint }} />} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {inventoryList.filter(m => !mdIsLowStock(m, mdEffectiveStock(m, medicationLogs, today))).map(renderMedRow)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Log an ad-hoc dose */}
      <Sheet open={!!logDraft} onClose={() => setLogDraft(null)} title="Log a dose" titleColor="var(--accent)">
        {logDraft && (
          <>
            <Field label="Medication" style={{ marginBottom: 14 }}>
              <select value={logDraft.medicationId} onChange={e => setLogDraft(d => ({ ...d, medicationId: e.target.value }))} style={mdInputStyle}>
                {activeMedications.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Amount" style={{ marginBottom: 16 }}>
              <input value={logDraft.doseQtyStr} onChange={e => setLogDraft(d => ({ ...d, doseQtyStr: mdDecimalFilter(e.target.value) }))}
                type="text" inputMode="decimal" placeholder="e.g. 2" style={mdInputStyle} autoFocus />
            </Field>
            <Btn onClick={saveLogDraft} disabled={!mdNum(logDraft.doseQtyStr)} style={{ width: '100%' }}>Log it</Btn>
          </>
        )}
      </Sheet>

      {/* Create/rename a plan */}
      <Sheet open={!!planNameDraft} onClose={() => setPlanNameDraft(null)} title={planNameDraft?.id ? 'Rename plan' : 'New plan'} titleColor="var(--accent)">
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

      {/* Edit / create a medication (identity + inventory + schedule) */}
      {/* open is gated on !slotDraft too: the "Add/edit time" sheet below
          stacks on top of this one while editing a schedule slot, hiding
          this sheet (rather than leaving both mounted and open at once,
          which left two same-labeled Save buttons live in the DOM
          simultaneously) without losing medSheet's own state, closing the
          slot sheet reveals this one again unchanged. */}
      <Sheet open={!!medSheet && !slotDraft} onClose={closeMedSheet} title={medSheet?.id ? 'Edit medication' : 'Add medication'} titleColor="var(--accent)">
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
            <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginBottom: 14 }}>
              {medSheet.id && mdEffectiveStock(medications.find(m => m.id === medSheet.id) || {}, medicationLogs, today) != null && (
                <div style={{ fontSize: 12, color: UI.ink, fontFamily: UI.fontUi, marginBottom: 8 }}>
                  Current stock: <span className="num">{mdFmtQty(mdEffectiveStock(medications.find(m => m.id === medSheet.id), medicationLogs, today), medSheet.unitLabel)}</span>
                </div>
              )}
              <Field label={`Update stock (${medSheet.unitLabel || 'pills'})`} style={{ marginBottom: 6 }}>
                <input value={medSheet.stockStr} onChange={e => setMedSheet(d => ({ ...d, stockStr: mdDecimalFilter(e.target.value) }))}
                  type="text" inputMode="decimal" placeholder="e.g. 60 after restocking" style={mdInputStyle} />
              </Field>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: '16px' }}>
                Tracks what's actually taken since, warns here once it drops below a package. Leave blank to keep the current count unchanged.
              </div>
            </div>
            {medSheet.id && (
              <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 14, marginBottom: 14 }}>
                <div className="micro" style={{ marginBottom: 8 }}>Schedule</div>
                {medSheetSlots.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {medSheetSlots.map(sl => (
                      <div key={sl.id} style={{ ...mdQuickRowInner, cursor: 'default', opacity: sl.active ? 1 : 0.5 }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: UI.ink, fontFamily: UI.fontUi }}>
                          {sl.weekdays.length === 7 ? 'Every day' : sl.weekdays.map(w => MD_WEEKDAY_SHORT[w]).join('/')} {String(sl.hour).padStart(2, '0')}:00 · {mdFmtQty(sl.doseQty, medSheet.unitLabel)}
                          {(sl.startDate || sl.endDate) && <span style={{ color: UI.inkFaint }}> ({sl.startDate || '…'} → {sl.endDate || '…'})</span>}
                        </div>
                        <button onClick={() => openSlotDraft(sl)} aria-label="Edit time" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4 }}><i className="fa-solid fa-pen" style={{ fontSize: 11 }} /></button>
                        <button onClick={() => deleteSlot(sl)} aria-label="Delete time" style={{ background: 'none', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4 }}><i className="fa-solid fa-xmark" style={{ fontSize: 14 }} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <Btn kind="ghost" onClick={() => openSlotDraft(null)} style={{ width: '100%' }}><i className="fa-solid fa-plus" style={{ marginRight: 8 }} />Add time</Btn>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {medSheet.id && <Btn kind="ghost" onClick={() => deleteMedication(medications.find(m => m.id === medSheet.id))} style={{ flex: 1, color: UI.danger }}>Delete</Btn>}
              <Btn onClick={saveMedSheet} disabled={!medSheet.name.trim()} style={{ flex: medSheet.id ? 2 : 1 }}>Save</Btn>
            </div>
          </>
        )}
      </Sheet>

      {/* Add/edit one schedule slot, nested within the medication sheet above */}
      <Sheet open={!!slotDraft} onClose={() => setSlotDraft(null)} title={slotDraft?.id ? 'Edit time' : 'Add time'} titleColor="var(--accent)">
        {slotDraft && (
          <>
            <div className="micro" style={{ marginBottom: 8 }}>Days</div>
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
            <Field label={`Dose (${medSheet?.unitLabel || 'pills'})`} style={{ marginBottom: 14 }}>
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
            {slotDraft.id && (
              <Field label="Active" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle on={slotDraft.active} onToggle={() => setSlotDraft(d => ({ ...d, active: !d.active }))} />
                  <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi }}>Paused times are kept but never fire</span>
                </div>
              </Field>
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
