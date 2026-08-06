/* Water Tracker screen: a full hydration tracker ported from the standalone
   Wasser Tracker app into Zane. Per-entry logging (quick water amounts, a
   configurable coffee preset, user-defined drinks, custom entries), a live
   activity ring, an expected-vs-actual day chart, a derived win streak, an
   optional bottle counter, a stats sheet with drag-to-inspect bars, and a
   day-nav (same idiom as the Food Tracker's, unbounded both ways) to view
   and backlog a day other than today.

   Water is stored canonically in ml (store.waterLogs, table zane_water_logs).
   On every mutation the day's summed ml is written back into the daily log's
   waterMl so the Health "Water" card and coaching hydration stay in sync from
   one source of truth. Display units go through the existing UI.water* helpers,
   so imperial (lbs) users automatically see fl oz. */

const { useState: useStateW, useEffect: useEffectW, useMemo: useMemoW, useRef: useRefW } = React;

// Water-semantic blue, decoupled from the user's accent (the Health tab already
// treats water as blue). Brand/interactive chrome still uses var(--accent*).
const WT_BLUE = '#4a9fe0';
const WT_BLUE_SOFT = 'rgba(74,159,224,0.35)';
const WT_BLUE_FAINT = 'rgba(74,159,224,0.12)';
const WT_BEHIND_ML = 120;                // grace before the "you're behind" nudge
const WT_MAX_DRINKS = 6;                  // user-defined "other drinks" cap
const WT_MAX_COFFEE = 8;                  // coffee-size cap
const WT_CELEBRATED_KEY = 'logbook-water-celebrated'; // per-device day guard for the success dialog

// Coffee stays a preset button (size + milk flow), but there are NO built-in
// size presets: everyone configures their own sizes in the water settings (for
// privacy and consistency with the user-defined drinks). Empty until added.
const WT_COFFEE_SIZES_DEFAULT = [];
const WT_MILK_OPTS = [20, 40, 60, 80, 100, 0];
const WT_CUSTOM_PRESETS_ML = [100, 150, 200, 300, 330, 400, 750, 1000];
// Drink-specific icons a user can pick for a custom drink (FA6 free solid).
// fa-blender is the shake/smoothie icon; fa-jar suits a protein shaker.
const WT_DRINK_ICONS = [
  'fa-glass-water', 'fa-glass-water-droplet', 'fa-bottle-water', 'fa-bottle-droplet',
  'fa-blender', 'fa-jar', 'fa-mug-hot', 'fa-mug-saucer',
  'fa-wine-glass', 'fa-wine-bottle', 'fa-martini-glass-citrus', 'fa-whiskey-glass',
  'fa-champagne-glasses', 'fa-beer-mug-empty', 'fa-bolt', 'fa-lemon',
  'fa-droplet', 'fa-martini-glass',
];
const WT_DEFAULT_DRINK_ICON = 'fa-glass-water';
// Coffee's own fixed tint (was blue like everything else here, but blue reads
// as "this is water" in this screen, which coffee obviously is not).
const WT_COFFEE_BROWN = '#8a6240';
const WT_DEFAULT_DRINK_COLOR = '#c9a961';
// Curated swatch palette for a custom drink's icon tint. Independent of the
// user's live accent color, same reasoning as WT_BLUE above: a theme change
// should never reshuffle a drink someone already picked a color for.
const WT_DRINK_COLORS = [
  WT_DEFAULT_DRINK_COLOR, '#c47828', '#d9733a', '#c96060', '#c9699a', '#9b6dd4',
  '#6272d4', '#4aab97', '#7ab05a', WT_COFFEE_BROWN, '#8a8578', '#5b9bd5',
];

function wtHexToRgba(hex, alpha) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  const n = parseInt(h, 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function wtDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return LB.fmtISO(d);
}
// Shifts an arbitrary date string, unlike wtDateStr above (always relative to
// right now). Same helper Food keeps under this exact name (fdShiftDate,
// screens-food.jsx) for its own day-nav.
function wtShiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return LB.fmtISO(d);
}
function wtHhmmToDecimal(t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}
// Full-precision ordering key for a logged entry. The stored `time` is only
// HH:MM, so two drinks logged seconds apart round to the identical string
// and a time-only sort can't tell them apart (their displayed order then
// falls back to whatever order they happen to sit in the underlying array,
// which does not reliably match when they were actually logged). `createdAt`
// carries full precision and is stamped in the same instant as `time`
// wherever entries are created, so it never contradicts the coarse field,
// only refines same-minute ties. Falls back to the coarse field if a row is
// ever missing it.
function wtEntryTs(e) {
  const ts = e.createdAt ? Date.parse(e.createdAt) : NaN;
  return isNaN(ts) ? wtHhmmToDecimal(e.time) * 3600000 : ts;
}
// Inclusive list of local YYYY-MM-DD strings from `from` to `to` (capped so a
// silly custom range can't build an unbounded array).
function wtDateRange(from, to) {
  const out = [];
  const cur = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
  let guard = 0;
  while (cur <= end && guard < 1000) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1); guard++;
  }
  return out;
}
function wtAmt(ml) { return `${UI.waterToEntry(ml)}`; }
function wtUnit() { return UI.waterEntryUnit(); }

// Win streak derived purely from the daily-log history.
function wtStreak(dailyLogs, goalMl) {
  if (!goalMl) return 0;
  const byDate = {};
  (dailyLogs || []).forEach(l => { if (l.waterMl != null) byDate[l.date] = l.waterMl; });
  let streak = 0, offset = 0;
  if ((byDate[wtDateStr(0)] || 0) < goalMl) offset = -1;
  while ((byDate[wtDateStr(offset)] || 0) >= goalMl) { streak++; offset--; }
  return streak;
}
function wtExpectedMl(goalMl, startTime, endTime) {
  const now = new Date();
  const nowDec = now.getHours() + now.getMinutes() / 60;
  const s = wtHhmmToDecimal(startTime), e = wtHhmmToDecimal(endTime);
  if (nowDec <= s) return 0;
  if (nowDec >= e) return goalMl;
  return Math.round(goalMl * (nowDec - s) / (e - s));
}

// Groups "other"-category entries by base drink name for a breakdown display:
// strips the "+ Nml Milk" suffix into a separate milk total, keeps each coffee
// size and each custom drink under its own name (not collapsed into a generic
// "Coffee"), and resolves an icon and color (coffee's fixed brown for a coffee
// size, the user's own pick for a custom drink, a default fallback otherwise).
// `coffeeLabels` is a plain array of coffee-size label strings. A past day
// collapsed by the nightly cron (migration 0183) has no raw entries left, only
// one category = 'summary' row with a pre-grouped breakdown.drinks/milk; that
// gets folded in the same way instead of parsed from a name, so a multi-day
// stats range keeps showing the drink breakdown even past "today".
function wtGroupOtherDrinks(entries, coffeeLabels, drinksList) {
  const grouped = {}; let milk = 0;
  const addDrink = (baseName, count) => {
    const isCoffee = coffeeLabels.includes(baseName);
    const drinkCfg = drinksList.find(d => d.name === baseName);
    const icon = isCoffee ? 'fa-mug-hot' : (drinkCfg?.icon || WT_DEFAULT_DRINK_ICON);
    const color = isCoffee ? WT_COFFEE_BROWN : (drinkCfg?.color || WT_DEFAULT_DRINK_COLOR);
    if (!grouped[baseName]) grouped[baseName] = { count: 0, icon, color };
    grouped[baseName].count += count;
  };
  entries.forEach(e => {
    if (e.category === 'summary') {
      Object.entries(e.breakdown?.drinks || {}).forEach(([baseName, count]) => addDrink(baseName, count));
      milk += e.breakdown?.milk || 0;
      return;
    }
    if (e.category !== 'other') return;
    const mm = e.name ? e.name.match(/\+\s*(\d+)ml Milk/i) : null;
    if (mm) milk += parseInt(mm[1], 10);
    const baseName = (e.name || 'Other').replace(/\s*\+\s*\d+ml Milk/i, '');
    addDrink(baseName, 1);
  });
  return { grouped, milk };
}

// ─── Activity ring ──────────────────────────────────────────────────
function WaterRing({ percent, size = 128 }) {
  const r = 50, circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(percent, 100) / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={UI.hair} strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={WT_BLUE} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: UI.fontNum, fontSize: 26, fontWeight: 600, color: isLightCanvasActive() ? '#0369a1' : WT_BLUE, fontVariantNumeric: 'tabular-nums',
      }}>{percent}%</div>
    </div>
  );
}

// ─── Expected vs actual, over the day ───────────────────────────────
// `date`: the day being charted, only used to label the hover tooltip
// correctly once this can show a day other than today. `live`: whether
// `date` is actually today, gating the "now" marker, the extra hover point
// anchored to it, and the pacing math behind both. Neither makes sense for a
// past, already-finished day (there is no "now" on that day's own timeline),
// and wall-clock hours belong to whatever day it actually is right now, not
// necessarily the day being charted.
function WaterDayChart({ entries, goalMl, startTime, endTime, date, live }) {
  let startH = Math.floor(wtHhmmToDecimal(startTime));
  let endH = Math.ceil(wtHhmmToDecimal(endTime));
  // An overnight/reversed window (startH >= endH) has no valid ramp: the tick
  // loop below would never run, leaving `actual` empty and crashing on
  // `actual[actual.length-1]`. saveGoalWindow guards against saving one, but
  // fall back defensively here too (a merge combining two devices' otherwise
  // valid windows, or data edited directly, could still produce one).
  if (endH <= startH) { startH = 8; endH = 22; }
  const span = Math.max(1, endH - startH);
  const W = 320, padL = 40, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const yMax = Math.max(goalMl, entries.reduce((a, e) => a + e.amountMl, 0)) * 1.05 || goalMl || 1;
  const xOf = h => padL + ((h - startH) / span) * plotW;
  const yOf = v => padTop + (1 - Math.min(v, yMax) / yMax) * plotH;
  const expectedAt = h => goalMl * (h - startH) / span;

  const ticks = [];
  for (let h = startH; h <= endH; h++) ticks.push(h);
  const sorted = [...entries].sort((a, b) => wtHhmmToDecimal(a.time) - wtHhmmToDecimal(b.time));
  let idx = 0, run = 0;
  const actual = ticks.map(h => {
    while (idx < sorted.length && wtHhmmToDecimal(sorted[idx].time) <= h) run += sorted[idx++].amountMl;
    return { h, v: run };
  });
  const expLine = ticks.map(h => `${xOf(h).toFixed(1)},${yOf(expectedAt(h)).toFixed(1)}`).join(' ');
  const actLine = actual.map(p => `${xOf(p.h).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);
  const gridVals = [0, 0.5, 1].map(f => goalMl * f);
  // Drag-to-inspect points, one per hourly tick (the chart's native
  // granularity), plus (while live) the exact "now" instant below so the
  // dashed now-line itself is a reachable target too (it rarely sits on a
  // whole hour). Anchored to the actual line (matches markerColor below),
  // Target sits alongside it as a second row so both series read at a glance.
  // No hint text: hideHint suppresses ChartHover's own "Drag to inspect"
  // label, which is redundant on a screen this small.
  const hoverPoints = actual.map(p => ({
    x: xOf(p.h), y: yOf(p.v), date, sub: `${String(p.h).padStart(2, '0')}:00`,
    rows: [
      { label: 'Target', value: `${wtAmt(expectedAt(p.h))} ${wtUnit()}`, color: UI.gold },
      { label: 'Actual', value: `${wtAmt(p.v)} ${wtUnit()}`, color: WT_BLUE },
    ],
  }));
  let nowDec = null;
  if (live) {
    const now = new Date();
    nowDec = Math.max(startH, Math.min(endH, now.getHours() + now.getMinutes() / 60));
    // Same clamped threshold the dashed line uses, so this point sits exactly
    // on it: real logged total up to right now, not an interpolated guess.
    const actualAtNow = sorted.reduce((a, e) => a + (wtHhmmToDecimal(e.time) <= nowDec ? e.amountMl : 0), 0);
    hoverPoints.push({
      x: xOf(nowDec), y: yOf(actualAtNow), date,
      sub: `Now · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      rows: [
        { label: 'Target', value: `${wtAmt(expectedAt(nowDec))} ${wtUnit()}`, color: UI.gold },
        { label: 'Actual', value: `${wtAmt(actualAtNow)} ${wtUnit()}`, color: WT_BLUE },
      ],
    });
  }

  return (
    <ChartHover W={W} H={H} points={hoverPoints} markerColor={WT_BLUE} hideHint>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text filter="url(#chart-text-lift)" x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{wtAmt(v)}</text>
        </g>
      ))}
      <line x1={padL} y1={base} x2={W - padR} y2={base} stroke={UI.hair} strokeWidth="0.5" />
      {ticks.filter((_, i) => i % Math.ceil(span / 6) === 0).map((h, i) => (
        <text filter="url(#chart-text-lift)" key={i} x={xOf(h).toFixed(1)} y={H - 6} textAnchor="middle" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{String(h).padStart(2, '0')}</text>
      ))}
      {live && <line x1={xOf(nowDec).toFixed(1)} y1={padTop} x2={xOf(nowDec).toFixed(1)} y2={base} stroke={UI.inkFaint} strokeWidth="1" strokeDasharray="2 3" />}
      <polyline points={expLine} fill="none" stroke={UI.gold} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.8" />
      <polygon points={`${xOf(startH).toFixed(1)},${base} ${actLine} ${xOf(actual[actual.length - 1].h).toFixed(1)},${base}`} fill={WT_BLUE_FAINT} />
      <polyline points={actLine} fill="none" stroke={WT_BLUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
    </ChartHover>
  );
}

// ─── Main screen ────────────────────────────────────────────────────
function WaterScreen({ store, setStore, go, userId }) {
  const [confirmEl, confirm] = useConfirm();
  const [settingsOpen, setSettingsOpen] = useStateW(false);
  const [customOpen, setCustomOpen] = useStateW(false);
  const [customMl, setCustomMl] = useStateW('');
  const [customName, setCustomName] = useStateW('');
  const [coffeeOpen, setCoffeeOpen] = useStateW(false);
  const [coffeeStep, setCoffeeStep] = useStateW('size');
  const [coffeeSel, setCoffeeSel] = useStateW(null); // { label, ml }
  const [statsOpen, setStatsOpen] = useStateW(false);
  const [drinksConfigOpen, setDrinksConfigOpen] = useStateW(false);
  const [goalSheetOpen, setGoalSheetOpen] = useStateW(false);
  const [bottleSheetOpen, setBottleSheetOpen] = useStateW(false);
  const [remindersSheetOpen, setRemindersSheetOpen] = useStateW(false);
  const [capturing, setCapturing] = useStateW(false);
  const captureRef = useRefW(null);

  const settings = store.settings || {};
  const goalMl = settings.waterGoalMl || 2000;
  const startTime = settings.waterStartTime || '08:00';
  const endTime = settings.waterEndTime || '22:00';
  const drinks = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks : []).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const coffeeSizes = ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes : WT_COFFEE_SIZES_DEFAULT).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const bottleEnabled = settings.waterBottleEnabled !== false;
  const bottleMl = settings.waterBottleMl || 1500;
  // Re-derived on a timer, not once per render: leaving this screen open over
  // midnight kept "today" on yesterday, so every entry added after 00:00
  // landed on the wrong day (and the ring kept showing yesterday's progress).
  const [today, setToday] = useStateW(() => wtDateStr(0));
  useEffectW(() => {
    const tick = () => setToday(cur => { const now = wtDateStr(0); return now === cur ? cur : now; });
    const iv = setInterval(tick, 30000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Day nav: same idiom as the Food Tracker's own date switcher
  // (screens-food.jsx), unbounded both ways. `today` above stays the
  // always-current date: the streak, the expected-vs-actual pacing, and the
  // celebration/bottle prompts all stay anchored to it, none of them make
  // sense for a day other than the one actually happening right now. `curDate`
  // is only "which day is currently displayed", defaults to `today` and is
  // otherwise fully independent of it, so viewing (or backlogging) another day
  // never has to fight the 30s/visibilitychange correction above.
  const [curDate, setCurDate] = useStateW(() => wtDateStr(0));
  const shiftDay = (delta) => setCurDate(d => wtShiftDate(d, delta));
  const isToday = curDate === today;
  const dayLabel = curDate === today ? 'Today' : curDate === wtShiftDate(today, -1) ? 'Yesterday' : curDate === wtShiftDate(today, 1) ? 'Tomorrow' : LB.fmtDayLabel(curDate);

  const dayEntries = useMemoW(
    () => (store.waterLogs || []).filter(l => l.date === curDate),
    [store.waterLogs, curDate],
  );
  const total = useMemoW(() => dayEntries.reduce((a, e) => a + (e.amountMl || 0), 0), [dayEntries]);
  const percent = Math.min(Math.round((total / goalMl) * 100), 100);
  // Always the real current streak, regardless of which day is displayed:
  // wtStreak walks backward from the true `today` inside itself (see its own
  // definition), not from curDate. That's the point of backlogging in the
  // first place, fixing a missed past day should be reflected here
  // immediately, whether or not that past day is what's currently on screen.
  const streak = useMemoW(() => wtStreak(store.dailyLogs, goalMl), [store.dailyLogs, goalMl]);

  const bottlesToday = (settings.waterBottlesDate === today) ? (settings.waterBottlesToday || 0) : 0;
  // Only ever consumed under an `isToday` gate below (the bottle card's
  // visibility, and doAdd's early return): the bottle counter
  // (settings.waterBottlesDate/-Today) is explicit today-only state, there is
  // no historical per-day bottle count to reconcile a past day's total
  // against, so this is meaningless for any other curDate.
  const plainToday = useMemoW(() => dayEntries.filter(e => !e.category).reduce((a, e) => a + e.amountMl, 0), [dayEntries]);
  const pendingBottle = bottleEnabled ? Math.max(0, plainToday - bottlesToday * bottleMl) : 0;

  const expected = wtExpectedMl(goalMl, startTime, endTime);
  const behind = total < expected - WT_BEHIND_ML;
  const missing = Math.max(200, Math.round(expected - total));

  const patchSettings = (patch) => setStore(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  // Writes the entry AND the recomputed day total into the daily log in one
  // atomic store update (both sync through syncStore; flushSync retries both).
  // Takes the target date explicitly: doAdd below needs either a
  // freshly-derived "right now" (not the up-to-30s-stale `today` state, L9,
  // audit-2026-08) or curDate if backlogging, and deleteEntry passes the
  // deleted entry's own date, so a past day's delete recomputes that day's
  // total rather than whatever's currently on screen.
  function patchDaily(s, entriesForDay, dateISO) {
    const sum = entriesForDay.reduce((a, e) => a + (e.amountMl || 0), 0);
    const existing = (s.dailyLogs || []).find(l => l.date === dateISO);
    const now = new Date().toISOString();
    const waterMl = sum > 0 ? sum : null;
    const log = existing
      ? { ...existing, waterMl, updatedAt: now }
      : { id: LB.uid(), date: dateISO, weight: null, steps: null, calories: null, protein: null, carbs: null, fat: null, fiber: null, waterMl, note: null, offPlanNote: null, coachFields: null, adherence: null, targetsSnap: null, updatedAt: now, createdAt: now };
    return [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== dateISO)];
  }

  async function doAdd(amountMl, name, category) {
    // Freshly derived when logging to TODAY, not the `today` state (only
    // re-derived every 30s or on visibilitychange, see its own comment
    // above): otherwise an add landing in that window right after local
    // midnight stamps the entry, and folds its total into the daily log, on
    // the day that just ended (L9, audit-2026-08). A deliberately backdated
    // add (curDate navigated away from today) isn't subject to that race, it
    // always targets curDate as-is, that's the whole point of the day nav.
    const entryDate = isToday ? wtDateStr(0) : curDate;
    const entry = { id: LB.uid(), date: entryDate, time: LB.nowHHMM(), amountMl: parseInt(amountMl, 10), name: name || null, category: category || null, createdAt: new Date().toISOString() };
    const prevTotal = total;
    setStore(s => {
      const nextLogs = [entry, ...(s.waterLogs || [])];
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, nextLogs.filter(l => l.date === entryDate), entryDate) };
    });
    // Celebration and bottle-crossing prompts are real-time, "you just did
    // this" moments: only fire for an add to TODAY. Backlogging a missed
    // drink into a past day isn't something to celebrate as if it just
    // happened, and the bottle counter has no historical per-day state to
    // update against a backdated add (see plainToday/bottlesToday above).
    if (!isToday) return;
    // useConfirm() holds only one dialog at a time, so the goal-reached and
    // bottle-empty prompts (both possibly triggered by the same add) must be
    // sequenced, not fired independently: awaiting the goal dialog here
    // means the bottle prompt below only opens once the user has actually
    // seen and dismissed it, instead of silently replacing it mid-display.
    let goalDialogShown = false;
    if (prevTotal < goalMl && prevTotal + entry.amountMl >= goalMl) {
      const seen = localStorage.getItem(WT_CELEBRATED_KEY);
      if (seen !== today) {
        localStorage.setItem(WT_CELEBRATED_KEY, today);
        goalDialogShown = true;
        await confirm(`You hit your ${wtAmt(goalMl)} ${wtUnit()} goal. Stay hydrated.`, { title: 'Goal reached', ok: 'Keep going', cancel: null });
      }
    }
    if (!category && bottleEnabled) {
      const nextPlain = plainToday + entry.amountMl;
      // How many whole bottles' worth were newly crossed by THIS add, not just
      // whether one was crossed: a small configured bottle size (smaller than
      // the largest quick-amount tile) lets a single add cross more than one.
      const crossed = Math.floor(Math.max(0, nextPlain - bottlesToday * bottleMl) / bottleMl);
      if (crossed >= 1) {
        if (!goalDialogShown) await new Promise(r => setTimeout(r, 300));
        const label = crossed > 1 ? `${crossed} bottles` : 'a bottle';
        const ok = await confirm(`You have logged enough water for ${label} via the quick amounts. Count ${crossed > 1 ? 'them' : 'it'} as emptied?`, { title: 'Bottle empty?', ok: crossed > 1 ? 'Yes, all empty' : 'Yes, empty', cancel: 'Not yet' });
        if (ok) setStore(s => ({ ...s, settings: { ...s.settings, waterBottlesToday: ((s.settings?.waterBottlesDate === today ? s.settings?.waterBottlesToday : 0) || 0) + crossed, waterBottlesDate: today } }));
      }
    }
  }

  async function addWithConfirm(amountMl, name, category) {
    const label = name ? `+${wtAmt(amountMl)} ${wtUnit()} · ${name}` : `+${wtAmt(amountMl)} ${wtUnit()}`;
    const ok = await confirm(label, { title: 'Add entry', ok: 'Add', cancel: 'Cancel' });
    if (ok) doAdd(amountMl, name, category);
  }

  async function deleteEntry(entry) {
    const label = entry.name ? `${wtAmt(entry.amountMl)} ${wtUnit()} · ${entry.name}` : `${wtAmt(entry.amountMl)} ${wtUnit()}`;
    const ok = await confirm(label, { title: 'Delete entry?', ok: 'Delete', cancel: 'Cancel', danger: true });
    if (!ok) return;
    setStore(s => {
      const nextLogs = (s.waterLogs || []).filter(l => l.id !== entry.id);
      // entry.date rather than curDate/today: a delete always recomputes the
      // day the deleted row actually belonged to, whichever day that is.
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, nextLogs.filter(l => l.date === entry.date), entry.date) };
    });
  }

  // Screenshot mode: hides everything interactive (quick-add tiles, the
  // drinks grid, delete buttons) so the capture is just the viewed day's
  // hero, day chart, breakdown and entry list, the parts worth sharing.
  // Reuses the shared captureNodeAsPng flow (screens-lib.jsx, same one the
  // plan poster and session share use) instead of a bespoke copy, so a
  // failed capture (html2canvas unavailable, encode failure) surfaces a real
  // error instead of silently no-op'ing.
  async function takeScreenshot() {
    if (!captureRef.current) return;
    const res = await captureNodeAsPng(captureRef.current, { filename: `water-${curDate}.png`, setCapturing });
    if (!res?.ok) {
      await confirm(res?.reason === 'unavailable'
        ? 'Could not build the image. Check your connection and try again.'
        : 'Could not build the image. Please try again.',
        { title: 'Export failed', ok: 'OK', cancel: null });
    }
  }

  const tiles = UI.waterInFloz()
    ? [8, 16, 24, 32].map(oz => ({ label: String(oz), ml: UI.flozToMl(oz) }))
    : [250, 500, 1000, 1500].map(ml => ({ label: String(ml), ml }));

  const openCoffee = () => { setCoffeeSel(null); setCoffeeStep('size'); setCoffeeOpen(true); };
  const confirmCoffee = (milkMl) => {
    setCoffeeOpen(false);
    const base = coffeeSel ? coffeeSel.ml : 0;
    const name = milkMl > 0 ? `${coffeeSel ? coffeeSel.label : 'Coffee'} + ${milkMl}ml Milk` : (coffeeSel ? coffeeSel.label : 'Coffee');
    addWithConfirm(base + milkMl, name, 'other');
  };

  const submitCustom = () => {
    const amount = parseInt(customMl, 10);
    if (!amount || isNaN(amount) || amount <= 0) return;
    const ml = UI.waterEntryToMl(amount);
    setCustomOpen(false);
    addWithConfirm(ml, customName.trim() || null, 'custom');
    setCustomMl(''); setCustomName('');
  };

  const breakdown = useMemoW(() => {
    const custom = dayEntries.filter(e => e.category === 'custom').reduce((sum, e) => sum + e.amountMl, 0);
    const { grouped, milk } = wtGroupOtherDrinks(dayEntries, coffeeSizes.map(s => s.label), drinks);
    return { grouped, milk, custom };
  }, [dayEntries, coffeeSizes, drinks]);

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Water" sub="Hydration" onBack={() => go({ name: 'home' })} right={
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={takeScreenshot} disabled={capturing} aria-label="Screenshot" style={{ ...wtIconBtn, cursor: capturing ? 'default' : 'pointer', color: capturing ? UI.inkGhost : UI.inkSoft }}>
            {capturing ? <span style={{ fontFamily: UI.fontUi, fontSize: 10 }}>…</span> : <i className="fa-solid fa-camera" style={{ fontSize: 15 }} />}
          </button>
          <button onClick={() => setStatsOpen(true)} aria-label="Stats" style={wtIconBtn}>
            <i className="fa-solid fa-chart-column" style={{ fontSize: 15 }} />
          </button>
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" style={wtIconBtn}>
            <i className="fa-solid fa-gear" style={{ fontSize: 15 }} />
          </button>
        </div>
      } />

      {/* No background of its own while live (the Screen canvas behind it,
          texture included, shows through). While capturing, an explicit solid
          fill blocks that canvas out (the CSS grid never survives
          html2canvas), and while the grid toggle is on SvgGrid redraws it in a
          way html2canvas actually renders. */}
      <div ref={captureRef} style={{ padding: capturing ? '14px 22px 16px' : '14px 22px calc(env(safe-area-inset-bottom, 8px) + 24px)', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', ...(capturing && { backgroundColor: UI.bg }) }}>
        {/* Negative z-index: this div's flex children are plain (non-positioned),
            which paint above a z-index:0 absolute sibling regardless of DOM
            order, so the grid needs to sit behind that baseline instead. */}
        {capturing && window.__gridEnabled && <SvgGrid style={{ zIndex: -1 }} />}

        {/* Day nav: same idiom as the Food Tracker's own date switcher
            (screens-food.jsx), unbounded both ways. Calendar button jumps
            straight to a date instead of stepping one day at a time (icon
            button + an overlaid invisible date input, a native picker needs a
            real <input type="date"> under the tap to open on iOS). Hidden
            while capturing: a shared screenshot is this day's stats, not a
            day-picker. */}
        {!capturing && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={() => shiftDay(-1)} aria-label="Previous day" style={wtNavBtn}>
              <i className="fa-solid fa-chevron-left" style={{ fontSize: 12 }} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{dayLabel}</div>
              <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
                <button aria-label="Jump to date" style={wtCalBtn}>
                  <i className="fa-solid fa-calendar-day" style={{ fontSize: 12 }} />
                </button>
                <input type="date" value={curDate}
                  onChange={e => e.target.value && setCurDate(e.target.value)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                />
              </div>
            </div>
            <button onClick={() => shiftDay(1)} aria-label="Next day" style={wtNavBtn}>
              <i className="fa-solid fa-chevron-right" style={{ fontSize: 12 }} />
            </button>
          </div>
        )}

        {/* Hero. Ring first (left), stats second (right): matches the Food
            Log's own hero (FdHeroContent, screens-food.jsx), which this one
            had drifted from by putting the ring on the right instead. No
            justifyContent and flex:1 on the stats block, same as Food's hero,
            so the two stay grouped instead of spreading apart on wide screens. */}
        <BracketFrame gold style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <WaterRing percent={percent} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="micro" style={{ color: UI.inkFaint }}>{dayLabel}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span className="num" style={{ fontSize: 44, fontWeight: 300, color: UI.ink, lineHeight: 1 }}>{wtAmt(total)}</span>
                <span style={{ fontSize: 16, color: UI.inkFaint, fontFamily: UI.fontUi }}>{wtUnit()}</span>
              </div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 8, fontFamily: UI.fontUi }}>of {wtAmt(goalMl)} {wtUnit()}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <i className="fa-solid fa-fire" style={{ fontSize: 12, color: streak > 0 ? UI.gold : UI.inkFaint }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: streak > 0 ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi }}>
                  {streak} day{streak === 1 ? '' : 's'} streak
                </span>
              </div>
            </div>
          </div>
        </BracketFrame>

        {/* Pacing nudge: wall-clock "how far along should I be by now"
            math, only meaningful while the day it's pacing is still in
            progress. */}
        {isToday && (behind ? (
          <Frame accent style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: WT_BLUE_SOFT, background: WT_BLUE_FAINT }}>
            <i className="fa-solid fa-droplet" style={{ fontSize: 20, color: WT_BLUE }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>You are behind</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Drink about {wtAmt(missing)} {wtUnit()} to catch up</div>
            </div>
          </Frame>
        ) : total < goalMl ? (
          <div style={{ textAlign: 'center', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>On track. Keep sipping.</div>
        ) : null)}

        {/* Quick amounts (interactive, hidden while capturing) */}
        {!capturing && (
        <div>
          <Bezel style={{ marginBottom: 10 }}>Amounts</Bezel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {tiles.map(t => (
              <button key={t.label} onClick={() => addWithConfirm(t.ml, null, null)} style={wtTile}>
                <i className="fa-solid fa-droplet" style={{ fontSize: 16, color: WT_BLUE, marginBottom: 6 }} />
                <div className="num" style={{ fontSize: 18, fontWeight: 600, color: UI.ink }}>{t.label}</div>
                <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi }}>{wtUnit()}</div>
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Current bottle (hidden while capturing: nobody sharing a screenshot
            wants their exact bottle fill state broadcast). isToday-gated:
            the bottle counter is explicit today-only state, its math
            (plainToday/bottlesToday) is meaningless once curDate is a
            different day, see the comments on those two above. */}
        {!capturing && isToday && bottleEnabled && pendingBottle > 0 && (
          <Card style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i className="fa-solid fa-bottle-water" style={{ fontSize: 12, color: WT_BLUE }} /> Current bottle
              </span>
              <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{pendingBottle} / {bottleMl} ml</span>
            </div>
            <div style={{ height: 6, background: UI.bgInset, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.round(pendingBottle / bottleMl * 100))}%`, background: WT_BLUE, borderRadius: 999, transition: 'width 0.5s' }} />
            </div>
          </Card>
        )}

        {/* Other drinks: coffee preset spans the full row, user drinks below
            (interactive add buttons, hidden while capturing) */}
        {!capturing && (
        <div>
          <Bezel style={{ marginBottom: 10 }}>Other drinks</Bezel>
          <button onClick={openCoffee} style={{ ...wtDrinkTile, width: '100%', justifyContent: 'center' }}>
            <span style={wtDrinkIconStyle(WT_COFFEE_BROWN)}><i className="fa-solid fa-mug-hot" style={{ fontSize: 15 }} /></span>
            <div style={{ textAlign: 'center', minWidth: 0 }}>
              <div style={wtDrinkName}>Coffee</div>
              <div style={wtDrinkMeta}>size + milk</div>
            </div>
          </button>
          {drinks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
              {drinks.map((d, i) => (
                <button key={i} onClick={() => addWithConfirm(d.ml, d.name, 'other')} style={wtDrinkTile}>
                  <span style={wtDrinkIconStyle(d.color || WT_DEFAULT_DRINK_COLOR)}><i className={`fa-solid ${d.icon || WT_DEFAULT_DRINK_ICON}`} style={{ fontSize: 15 }} /></span>
                  <div style={{ textAlign: 'left', minWidth: 0 }}>
                    <div style={wtDrinkName}>{d.name}</div>
                    <div style={wtDrinkMeta}>{d.ml} ml</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {drinks.length === 0 && (
            <button onClick={() => setSettingsOpen(true)} style={{ marginTop: 8, width: '100%', textAlign: 'center', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
              Add your own drinks in settings
            </button>
          )}
        </div>
        )}

        {!capturing && (
        <Btn kind="ghost" onClick={() => { setCustomMl(''); setCustomName(''); setCustomOpen(true); }} style={{ width: '100%' }}>
          <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Custom entry
        </Btn>
        )}

        {/* Day chart */}
        <Card style={{ padding: 14 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Target vs actual</div>
          <WaterDayChart entries={dayEntries} goalMl={goalMl} startTime={startTime} endTime={endTime} date={curDate} live={isToday} />
        </Card>

        {/* Breakdown (hidden while capturing: a shared screenshot is meant to
            show the day's progress, not a full drink-by-drink inventory).
            The Bottles row is isToday-gated same as the card above: bottlesToday
            is always TODAY's count regardless of curDate, so it would otherwise
            bleed a live count into a past day's breakdown. */}
        {!capturing && (Object.keys(breakdown.grouped).length > 0 || breakdown.milk > 0 || breakdown.custom > 0 || (isToday && bottlesToday > 0)) && (
          <Card style={{ padding: 14 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Other drinks</div>
            {isToday && bottleEnabled && bottlesToday > 0 && <WaterBreakdownRow icon="fa-bottle-water" name="Bottles" value={`${bottlesToday}x`} />}
            {Object.entries(breakdown.grouped).sort((a, b) => b[1].count - a[1].count).map(([name, g]) => (
              <WaterBreakdownRow key={name} icon={g.icon} name={name} value={`${g.count}x`} color={g.color} />
            ))}
            {breakdown.milk > 0 && <WaterBreakdownRow icon="fa-cow" name="Milk" value={`${breakdown.milk} ml`} />}
            {breakdown.custom > 0 && <WaterBreakdownRow icon="fa-pen" name="Custom entries" value={`${breakdown.custom} ml`} />}
          </Card>
        )}

        {/* Entry log (hidden while capturing: a shared screenshot is the
            day's totals, not a timestamped log of every single drink) */}
        {!capturing && (
        <div>
          <Bezel style={{ marginBottom: 10 }}>Entries ({dayEntries.length})</Bezel>
          {dayEntries.length === 0 ? (
            <div style={{ textAlign: 'center', fontSize: 12, color: UI.inkFaint, padding: '18px 0', fontFamily: UI.fontUi }}>Nothing logged for this day</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...dayEntries].sort((a, b) => wtEntryTs(b) - wtEntryTs(a)).map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                    <span className="num" style={{ fontSize: 12, color: isLightCanvasActive() ? '#0369a1' : WT_BLUE }}>{e.time}</span>
                    <span className="num" style={{ fontSize: 14, fontWeight: 600, color: UI.ink }}>+{e.amountMl} ml</span>
                    {e.name && <span style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>}
                  </div>
                  <button onClick={() => deleteEntry(e)} aria-label="Delete" style={{ background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 6, WebkitTapHighlightColor: 'transparent' }}>
                    <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>

      {/* ── Settings hub: Goal, Bottle Tracker, Reminders and Drinks each get
          their own focused sub-sheet instead of one long scroll. Every child
          below is a PUSH, not a stack: opening one closes this hub and
          closing it reopens the hub. Two Sheets open at once each run their
          own visualViewport keyboard handler, and both fire scrollIntoView on
          the focused field, which makes the view jump wildly on focus. One
          sheet open at a time keeps input focus calm. ── */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Water settings" titleColor="var(--accent)">
        <WaterSettingsHubBody settings={settings}
          onOpenGoal={() => { setSettingsOpen(false); setGoalSheetOpen(true); }}
          onOpenBottle={() => { setSettingsOpen(false); setBottleSheetOpen(true); }}
          onOpenReminders={() => { setSettingsOpen(false); setRemindersSheetOpen(true); }}
          onOpenDrinks={() => { setSettingsOpen(false); setDrinksConfigOpen(true); }} />
      </Sheet>

      {/* ── Daily Goal sub-sheet ── */}
      <Sheet open={goalSheetOpen} onClose={() => { setGoalSheetOpen(false); setSettingsOpen(true); }} title="Daily Goal" titleColor="var(--accent)">
        <WaterGoalWindowBody settings={settings} patchSettings={patchSettings} onClose={() => { setGoalSheetOpen(false); setSettingsOpen(true); }} />
      </Sheet>

      {/* ── Bottle Tracker sub-sheet ── */}
      <Sheet open={bottleSheetOpen} onClose={() => { setBottleSheetOpen(false); setSettingsOpen(true); }} title="Bottle Tracker" titleColor="var(--accent)">
        <WaterBottleTrackerBody settings={settings} patchSettings={patchSettings} onClose={() => { setBottleSheetOpen(false); setSettingsOpen(true); }} />
      </Sheet>

      {/* ── Reminders sub-sheet ── */}
      <Sheet open={remindersSheetOpen} onClose={() => { setRemindersSheetOpen(false); setSettingsOpen(true); }} title="Reminders" titleColor="var(--accent)">
        <WaterRemindersBody settings={settings} patchSettings={patchSettings} go={go} onClose={() => { setRemindersSheetOpen(false); setSettingsOpen(true); }} />
      </Sheet>

      {/* ── Drinks & coffee config sub-sheet (own sheet to keep settings tidy) ── */}
      <Sheet open={drinksConfigOpen} onClose={() => { setDrinksConfigOpen(false); setSettingsOpen(true); }} title="Drinks & coffee" titleColor="var(--accent)">
        <WaterDrinksConfigBody settings={settings} patchSettings={patchSettings} onClose={() => { setDrinksConfigOpen(false); setSettingsOpen(true); }} />
      </Sheet>

      {/* ── Custom entry sheet ── */}
      <Sheet open={customOpen} onClose={() => setCustomOpen(false)} title="Custom entry" titleColor="var(--accent)">
        <Field label={`Amount (${wtUnit()})`} style={{ marginBottom: 14 }}>
          <input value={customMl} onChange={e => setCustomMl(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder={wtUnit()} autoFocus style={wtBigInput} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {WT_CUSTOM_PRESETS_ML.map(ml => {
            const shown = UI.waterInFloz() ? Math.round(UI.mlToFloz(ml)) : ml;
            return <button key={ml} onClick={() => setCustomMl(String(shown))} style={wtPreset}>{shown}<span style={{ fontSize: 9, color: UI.inkFaint, display: 'block' }}>{wtUnit()}</span></button>;
          })}
        </div>
        <Field label="Name (optional)" style={{ marginBottom: 16 }}>
          <TextInput value={customName} onChange={setCustomName} placeholder="e.g. Juice, Tea" />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="ghost" onClick={() => setCustomOpen(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={submitCustom} style={{ flex: 2 }}>Add</Btn>
        </div>
      </Sheet>

      {/* ── Coffee sheet ── */}
      <Sheet open={coffeeOpen} onClose={() => setCoffeeOpen(false)} title={coffeeStep === 'size' ? 'Which coffee?' : 'Milk?'} titleColor="var(--accent)">
        {coffeeStep === 'size' ? (
          coffeeSizes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4px 0' }}>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: '20px' }}>No coffee sizes yet. Add your own in the water settings.</div>
              <Btn onClick={() => { setCoffeeOpen(false); setSettingsOpen(true); }} style={{ width: '100%' }}>Open settings</Btn>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {coffeeSizes.map((s, i) => (
                <button key={i} onClick={() => { setCoffeeSel(s); setCoffeeStep('milk'); }} style={wtPillOpt}>
                  {s.label}<span style={{ fontSize: 10, color: UI.inkFaint, display: 'block', marginTop: 2 }}>{s.ml} ml</span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div>
            <div style={{ fontSize: 12, color: UI.inkSoft, marginBottom: 14, fontFamily: UI.fontUi }}>Base {coffeeSel ? coffeeSel.ml : 0} ml. How much milk?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
              {WT_MILK_OPTS.map(m => (
                <button key={m} onClick={() => confirmCoffee(m)} style={wtPillOpt}>{m === 0 ? 'None' : `${m} ml`}</button>
              ))}
            </div>
            <Btn kind="ghost" onClick={() => setCoffeeStep('size')} style={{ width: '100%' }}>Back</Btn>
          </div>
        )}
      </Sheet>

      {/* ── Stats sheet ── */}
      <Sheet open={statsOpen} onClose={() => setStatsOpen(false)} title="Stats" titleColor="var(--accent)">
        <WaterStatsBody store={store} goalMl={goalMl} />
      </Sheet>
    </Screen>
  );
}

function WaterBreakdownRow({ icon, name, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, fontFamily: UI.fontUi }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: UI.ink }}>
        <i className={`fa-solid ${icon}`} style={{ fontSize: 12, color: color || UI.inkFaint, width: 16, textAlign: 'center' }} />{name}
      </span>
      <span className="num" style={{ color: color || (isLightCanvasActive() ? '#0369a1' : WT_BLUE), fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// Settings body: goal, window, bottle tracker, reminders, custom drinks, coffee sizes.
// Rows below use the shared NavRow (screens-settings.jsx loads earlier in
// index.html's SOURCES, so it's already a plain callable global here) instead
// of a local copy, same flat divided-list look as every other Settings
// sub-sheet (Health, Food).
// Settings top-level hub: drills into Goal, Bottle Tracker, Reminders and
// Drinks instead of one long scroll through all four at once. Shared by the
// Water tracker's own settings sheet and Settings > Health & Nutrition >
// Water (that one wraps this in its own "Show tab" toggle, not part of this
// shared body).
function WaterSettingsHubBody({ settings, onOpenGoal, onOpenBottle, onOpenReminders, onOpenDrinks }) {
  const bottleEnabled = settings.waterBottleEnabled !== false;
  const reminderOn = !!settings.waterReminderEnabled;
  const drinkCount = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks.length : 0)
    + ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes.length : 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <NavRow label="Daily Goal" first hint={`${UI.waterToEntry(settings.waterGoalMl || 2000)} ${UI.waterEntryUnit()}`} onTap={onOpenGoal} />
      <NavRow label="Bottle Tracker" hint={bottleEnabled ? 'On' : 'Off'} onTap={onOpenBottle} />
      <NavRow label="Reminders" hint={reminderOn ? 'On' : 'Off'} onTap={onOpenReminders} />
      <NavRow label="Drinks & Coffee" hint={drinkCount > 0 ? `${drinkCount} set` : null} onTap={onOpenDrinks} />
    </div>
  );
}
// Sub-sheet body: the daily target and the window it's spread across.
function WaterGoalWindowBody({ settings, patchSettings, onClose }) {
  const [goal, setGoal] = useStateW(String(UI.waterToEntry(settings.waterGoalMl || 2000)));
  const [start, setStart] = useStateW(settings.waterStartTime || '08:00');
  const [end, setEnd] = useStateW(settings.waterEndTime || '22:00');
  const timeColorScheme = ['light', 'paper'].includes(settings.darkMode ?? 'dark') ? 'light' : 'dark';
  const timeStyle = { ...wtInput, colorScheme: timeColorScheme };

  const saveGoalWindow = () => {
    const entry = parseInt(goal, 10);
    const ml = entry > 0 ? UI.waterEntryToMl(entry) : 2000;
    // An overnight/reversed window (start hour >= end hour) has no valid ramp:
    // WaterDayChart's tick loop never runs and the day-total math divides by a
    // non-positive span. Clamp end to at least an hour past start instead of
    // silently saving something that crashes the Water screen on next open.
    const validEnd = wtHhmmToDecimal(end) > wtHhmmToDecimal(start) ? end : '23:59';
    if (validEnd !== end) setEnd(validEnd);
    patchSettings({ waterGoalMl: ml, waterStartTime: start, waterEndTime: validEnd });
  };

  return (
    <div>
      <Field label={`Daily goal (${UI.waterEntryUnit()})`} style={{ marginBottom: 14 }}>
        <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^0-9]/g, ''))} onBlur={saveGoalWindow} type="text" inputMode="numeric" style={wtBigInput} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <Field label="Start time"><input type="time" value={start} onChange={e => setStart(e.target.value)} onBlur={saveGoalWindow} style={timeStyle} /></Field>
        <Field label="End time"><input type="time" value={end} onChange={e => setEnd(e.target.value)} onBlur={saveGoalWindow} style={timeStyle} /></Field>
      </div>
      <Btn onClick={() => { saveGoalWindow(); onClose(); }} style={{ width: '100%' }}>Done</Btn>
    </div>
  );
}
// Sub-sheet body: the emptied-bottle counter and its size.
function WaterBottleTrackerBody({ settings, patchSettings, onClose }) {
  const [bottleMlDraft, setBottleMlDraft] = useStateW(String(settings.waterBottleMl || 1500));
  const bottleEnabled = settings.waterBottleEnabled !== false;

  const saveBottleMl = () => {
    // Commit on blur, like the goal field: committing on every keystroke would
    // write waterBottleMl:0 into synced settings the instant the field is
    // cleared to retype it (parseInt('') is NaN, || 0 -> 0).
    const parsed = parseInt(bottleMlDraft, 10);
    const ml = parsed > 0 ? parsed : (settings.waterBottleMl || 1500);
    setBottleMlDraft(String(ml));
    patchSettings({ waterBottleMl: ml });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bottleEnabled ? 12 : 20 }}>
        <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>Count emptied bottles</span>
        <Toggle on={bottleEnabled} onToggle={() => patchSettings({ waterBottleEnabled: !bottleEnabled })} />
      </div>
      {bottleEnabled && (
        <Field label="Bottle size (ml)" style={{ marginBottom: 20 }}>
          <input value={bottleMlDraft} onChange={e => setBottleMlDraft(e.target.value.replace(/[^0-9]/g, ''))} onBlur={saveBottleMl} type="text" inputMode="numeric" style={wtInput} />
        </Field>
      )}
      <Btn onClick={onClose} style={{ width: '100%' }}>Done</Btn>
    </div>
  );
}
// Sub-sheet body: the fall-behind nudge.
function WaterRemindersBody({ settings, patchSettings, go, onClose }) {
  const reminderOn = !!settings.waterReminderEnabled;
  const pushOn = !!settings.pushEnabled;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>Nudge me when I fall behind</span>
        <Toggle on={reminderOn} onToggle={() => patchSettings({ waterReminderEnabled: !reminderOn })} />
      </div>
      {reminderOn && !pushOn && (
        <button onClick={() => { onClose(); go({ name: 'settings' }); }} style={{ width: '100%', textAlign: 'left', fontSize: 12, color: UI.warn, fontFamily: UI.fontUi, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 4px' }}>
          Notifications are off. Turn them on in Settings to receive these.
        </button>
      )}
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20, lineHeight: '16px' }}>
        Uses your existing notification channel (Web Push or Pushover). Sent during your daily window.
      </div>
      <Btn onClick={onClose} style={{ width: '100%' }}>Done</Btn>
    </div>
  );
}

// Shared selected/unselected chrome for a swatch button in the icon or color
// grid below (background tint + border), so the two grids can't drift out of
// visual sync. Padding and the icon-only glyph tint stay per-call-site since
// an icon glyph gets tinted by selection and a color dot must not be.
function wtSwatchBtnStyle(sel) {
  return {
    display: 'grid', placeItems: 'center', borderRadius: 6, cursor: 'pointer',
    background: sel ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset,
    border: `var(--hair-width) solid ${sel ? 'var(--hair-accent)' : UI.hair}`,
    WebkitTapHighlightColor: 'transparent',
  };
}

// Sub-sheet body: manage the up-to-6 custom drinks and the coffee sizes.
function WaterDrinksConfigBody({ settings, patchSettings, onClose }) {
  const drinks = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks : []).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const coffee = ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes : WT_COFFEE_SIZES_DEFAULT).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const [drinkName, setDrinkName] = useStateW('');
  const [drinkMl, setDrinkMl] = useStateW('');
  const [drinkIcon, setDrinkIcon] = useStateW(WT_DEFAULT_DRINK_ICON);
  const [drinkColor, setDrinkColor] = useStateW(WT_DEFAULT_DRINK_COLOR);
  // Index into the sorted `drinks` array below, null while adding a new one.
  const [editIdx, setEditIdx] = useStateW(null);
  const [cLabel, setCLabel] = useStateW('');
  const [cMl, setCMl] = useStateW('');

  const resetDrinkForm = () => {
    setDrinkName(''); setDrinkMl(''); setDrinkIcon(WT_DEFAULT_DRINK_ICON); setDrinkColor(WT_DEFAULT_DRINK_COLOR); setEditIdx(null);
  };
  const startEditDrink = (i) => {
    const d = drinks[i];
    setDrinkName(d.name); setDrinkMl(String(UI.waterToEntry(d.ml))); setDrinkIcon(d.icon || WT_DEFAULT_DRINK_ICON); setDrinkColor(d.color || WT_DEFAULT_DRINK_COLOR);
    setEditIdx(i);
  };
  const saveDrink = () => {
    const entry = parseInt(drinkMl, 10);
    if (!drinkName.trim() || !entry || entry <= 0) return;
    const next = { name: drinkName.trim(), ml: UI.waterEntryToMl(entry), icon: drinkIcon, color: drinkColor };
    if (editIdx != null) {
      patchSettings({ waterDrinks: drinks.map((d, idx) => idx === editIdx ? next : d) });
    } else {
      if (drinks.length >= WT_MAX_DRINKS) return;
      patchSettings({ waterDrinks: [...drinks, next] });
    }
    resetDrinkForm();
  };
  const removeDrink = (i) => {
    patchSettings({ waterDrinks: drinks.filter((_, idx) => idx !== i) });
    if (editIdx === i) resetDrinkForm();
  };
  const addCoffee = () => {
    const entry = parseInt(cMl, 10);
    if (!cLabel.trim() || !entry || entry <= 0 || coffee.length >= WT_MAX_COFFEE) return;
    patchSettings({ waterCoffeeSizes: [...coffee, { label: cLabel.trim(), ml: UI.waterEntryToMl(entry) }] });
    setCLabel(''); setCMl('');
  };
  const removeCoffee = (i) => patchSettings({ waterCoffeeSizes: coffee.filter((_, idx) => idx !== i) });
  const drinksLeft = WT_MAX_DRINKS - drinks.length;

  return (
    <div>
      {/* Custom drinks */}
      <Bezel style={{ marginBottom: 12 }}>Other drinks</Bezel>
      <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 10 }}>
        {editIdx != null ? 'Tap the row again, or another one, to change your edit.'
          : drinksLeft > 0 ? `Add up to ${drinksLeft} custom drink${drinksLeft === 1 ? '' : 's'}. Tap one to edit it.`
          : 'You have added the maximum of 6 drinks. Tap one to edit it.'}
      </div>
      {drinks.map((d, i) => (
        <WaterConfigRow key={i} left={d.name} right={`${wtAmt(d.ml)} ${wtUnit()}`} icon={d.icon || WT_DEFAULT_DRINK_ICON} color={d.color || WT_DEFAULT_DRINK_COLOR} active={editIdx === i} onEdit={() => (editIdx === i ? resetDrinkForm() : startEditDrink(i))} onRemove={() => removeDrink(i)} />
      ))}
      {(drinksLeft > 0 || editIdx != null) && (
        <div style={{ marginTop: 4, marginBottom: 20 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>Icon</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
            {WT_DRINK_ICONS.map(ic => {
              const sel = drinkIcon === ic;
              return (
                <button key={ic} onClick={() => setDrinkIcon(ic)} aria-label={ic.replace('fa-', '')} style={{
                  ...wtSwatchBtnStyle(sel), padding: '10px 0', color: sel ? 'var(--accent)' : UI.inkSoft,
                }}>
                  <i className={`fa-solid ${ic}`} style={{ fontSize: 16 }} />
                </button>
              );
            })}
          </div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
            {WT_DRINK_COLORS.map(c => {
              const sel = drinkColor === c;
              return (
                <button key={c} onClick={() => setDrinkColor(c)} aria-label={`Color ${c}`} style={{ ...wtSwatchBtnStyle(sel), padding: '8px 0' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: c }} />
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 2 }}><TextInput value={drinkName} onChange={setDrinkName} placeholder="Name" /></div>
            <div style={{ flex: 1 }}>
              <input value={drinkMl} onChange={e => setDrinkMl(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder={wtUnit()} style={wtInput} />
            </div>
            {editIdx == null && <Btn onClick={saveDrink} style={{ flexShrink: 0, minHeight: 40, padding: '10px 16px' }}>Add</Btn>}
          </div>
          {editIdx != null && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Btn kind="ghost" onClick={resetDrinkForm} style={{ flex: 1, minHeight: 40 }}>Cancel</Btn>
              <Btn onClick={saveDrink} style={{ flex: 1, minHeight: 40 }}>Save</Btn>
            </div>
          )}
        </div>
      )}

      {/* Coffee sizes */}
      <Bezel style={{ marginBottom: 12 }}>Coffee sizes</Bezel>
      <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 10 }}>Your own sizes in the coffee button.</div>
      {coffee.map((s, i) => (
        <WaterConfigRow key={i} left={s.label} right={`${wtAmt(s.ml)} ${wtUnit()}`} onRemove={() => removeCoffee(i)} />
      ))}
      {coffee.length < WT_MAX_COFFEE && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 4, marginBottom: 20 }}>
          <div style={{ flex: 2 }}><TextInput value={cLabel} onChange={setCLabel} placeholder="Label" /></div>
          <div style={{ flex: 1 }}>
            <input value={cMl} onChange={e => setCMl(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder={wtUnit()} style={wtInput} />
          </div>
          <Btn onClick={addCoffee} style={{ flexShrink: 0, minHeight: 40, padding: '10px 16px' }}>Add</Btn>
        </div>
      )}

      <Btn onClick={onClose} style={{ width: '100%', marginTop: 4 }}>Done</Btn>
    </div>
  );
}

function WaterConfigRow({ left, right, onRemove, onEdit, icon, color, active }) {
  return (
    <div onClick={onEdit} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px',
      background: active ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset,
      border: `var(--hair-width) solid ${active ? 'rgba(var(--accent-rgb),0.35)' : UI.hair}`, borderRadius: 6, marginBottom: 6,
      cursor: onEdit ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: color || WT_DEFAULT_DRINK_COLOR, width: 16, textAlign: 'center' }} />}
        {left}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{right}</span>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} aria-label="Remove" style={{ background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, WebkitTapHighlightColor: 'transparent' }}>
          <i className="fa-solid fa-trash" style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  );
}

// Stats body: 7/30/90/custom water history with drag-to-inspect bars (reuses the
// Health bar chart), KPIs, and a per-period other-drinks breakdown. Totals come
// from the daily logs, the drink breakdown from the per-entry water logs.
function WaterStatsBody({ store, goalMl }) {
  const [period, setPeriod] = useStateW(30);
  const [from, setFrom] = useStateW(wtDateStr(-29));
  const [to, setTo] = useStateW(wtDateStr(0));
  const timeColorScheme = ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark';
  const coffeeLabels = (store.settings?.waterCoffeeSizes || []).map(s => s.label);

  const range = useMemoW(() => {
    if (period === 'custom') return (from > to) ? { from: to, to: from } : { from, to };
    return { from: wtDateStr(-(period - 1)), to: wtDateStr(0) };
  }, [period, from, to]);

  const s = useMemoW(() => {
    const byDate = {};
    (store.dailyLogs || []).forEach(l => { if (l.waterMl != null) byDate[l.date] = l.waterMl; });
    const days = wtDateRange(range.from, range.to).map(d => ({ date: d, value: byDate[d] || 0 }));
    const withData = days.filter(d => d.value > 0);
    const goalDays = days.filter(d => d.value >= goalMl);
    const avg = withData.length ? Math.round(withData.reduce((a, d) => a + d.value, 0) / withData.length) : 0;
    // Of days actually logged, not every calendar day in range: goalMl is
    // always > 0 (270: `settings.waterGoalMl || 2000`), so a day with no log
    // at all can never be in goalDays either way, dividing by days.length
    // just made a day you forgot to open the app on count as a miss and
    // dragged the rate down for reasons that have nothing to do with the
    // goal itself.
    const rate = withData.length ? Math.round((goalDays.length / withData.length) * 100) : 0;
    let best = 0, cur = 0;
    days.forEach(d => { if (d.value >= goalMl) { cur++; best = Math.max(best, cur); } else cur = 0; });
    const waterDrinksList = store.settings?.waterDrinks || [];
    const entriesInRange = (store.waterLogs || []).filter(e => e.date >= range.from && e.date <= range.to);
    const { grouped: drinks, milk } = wtGroupOtherDrinks(entriesInRange, coffeeLabels, waterDrinksList);
    const top = Object.entries(drinks).sort((a, b) => b[1].count - a[1].count)[0];
    return { days, withData: withData.length, goalDays: goalDays.length, avg, rate, best, drinks, milk, fav: top ? top[0] : null, favN: top ? top[1].count : 0 };
  }, [store.dailyLogs, store.waterLogs, store.settings?.waterDrinks, range, goalMl, coffeeLabels]);

  const segBtn = (id, label) => (
    <button onClick={() => setPeriod(id)} style={{
      flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
      background: period === id ? 'var(--accent)' : 'transparent',
      color: period === id ? 'var(--accent-ink)' : UI.inkFaint,
      textShadow: period === id ? 'none' : 'var(--text-lift)',
      fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
  const statCard = (label, value, sub) => (
    <div style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, padding: '11px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 5 }}>{label}</div>
      <div className="num" style={{ fontSize: 19, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}{sub && <span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 4, fontFamily: UI.fontUi }}>{sub}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hairStrong}`, marginBottom: 14 }}>
        {segBtn(7, '7D')}{segBtn(30, '30D')}{segBtn(90, '90D')}{segBtn('custom', 'Custom')}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...wtInput, colorScheme: timeColorScheme }} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...wtInput, colorScheme: timeColorScheme }} /></Field>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <HealthBarChart series={s.days} from={range.from} to={range.to}
          format={v => `${UI.waterSummaryValue(v)}${UI.waterSummaryUnit()}`} target={goalMl}
          color={WT_BLUE} colorSoft={WT_BLUE_SOFT} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {statCard('Best streak', `🔥 ${s.best}`, 'days')}
        {statCard('Goal hit', `${s.rate}`, '%')}
        {statCard('Goal days', `${s.goalDays}`, 'days')}
        {statCard('Days logged', `${s.withData}`, 'days')}
        {statCard('Avg / day', `${s.avg}`, 'ml')}
        {statCard('Top drink', s.fav || 'None', s.fav ? `${s.favN}x` : null)}
      </div>
      {(Object.keys(s.drinks).length > 0 || s.milk > 0) && (
        <Card style={{ padding: 14 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Other drinks this period</div>
          {Object.entries(s.drinks).sort((a, b) => b[1].count - a[1].count).map(([name, g]) => (
            <WaterBreakdownRow key={name} icon={g.icon} name={name} value={`${g.count}x`} color={g.color} />
          ))}
          {s.milk > 0 && <WaterBreakdownRow icon="fa-cow" name="Milk" value={`${s.milk} ml`} />}
        </Card>
      )}
    </div>
  );
}

// ─── Local style constants ──────────────────────────────────────────
const wtIconBtn = {
  width: 34, height: 34, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  WebkitTapHighlightColor: 'transparent',
};
// Day-nav chevron + calendar-jump buttons, same shapes as Food's own
// fdNavBtn(false)/fdIconBtn(26) (screens-food.jsx).
const wtNavBtn = {
  width: 32, height: 32, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
};
const wtCalBtn = {
  flexShrink: 0, width: 26, height: 26, borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
};
const wtTile = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '14px 6px 10px', borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, textShadow: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const wtDrinkTile = {
  display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 6,
  border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset, textShadow: 'none', cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', overflow: 'hidden',
};
const wtDrinkIcon = {
  width: 34, height: 34, borderRadius: 6, display: 'grid', placeItems: 'center', flexShrink: 0,
};
// Same faint/soft alpha steps WT_BLUE_FAINT/WT_BLUE_SOFT used, just built from
// whatever color this particular drink (or coffee) was assigned.
function wtDrinkIconStyle(color) {
  return { ...wtDrinkIcon, background: wtHexToRgba(color, 0.12), border: `var(--hair-width) solid ${wtHexToRgba(color, 0.35)}`, color };
}
const wtDrinkName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const wtDrinkMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 };
const wtInput = {
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
  color: UI.ink, fontFamily: UI.fontNum, fontSize: 16, padding: '10px 12px', width: '100%',
  WebkitAppearance: 'none',
};
const wtBigInput = { ...wtInput, fontSize: 22, padding: '12px 14px' };
const wtPreset = {
  padding: '10px 0', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontNum, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
const wtPillOpt = {
  padding: '13px 8px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, textShadow: 'none', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center',
  WebkitTapHighlightColor: 'transparent',
};

window.Screens = window.Screens || {};
Object.assign(window.Screens, { WaterScreen });
