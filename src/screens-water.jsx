/* Water Tracker screen: a full hydration tracker ported from the standalone
   Wasser Tracker app into Zane. Per-entry logging (quick water amounts, a
   configurable coffee preset, user-defined drinks, custom entries), a live
   activity ring, an expected-vs-actual day chart, a derived win streak, an
   optional bottle counter, and a stats sheet with drag-to-inspect bars.

   Water is stored canonically in ml (store.waterLogs, table zane_water_logs).
   On every mutation the day's summed ml is written back into the daily log's
   waterMl so the Health "Water" card and coaching hydration stay in sync from
   one source of truth. Display units go through the existing UI.water* helpers,
   so imperial (lbs) users automatically see fl oz. */

const { useState: useStateW, useEffect: useEffectW, useMemo: useMemoW } = React;

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

function wtDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function wtNowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function wtHhmmToDecimal(t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
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
        fontFamily: UI.fontNum, fontSize: 26, fontWeight: 600, color: WT_BLUE, fontVariantNumeric: 'tabular-nums',
      }}>{percent}%</div>
    </div>
  );
}

// ─── Expected vs actual, over the day ───────────────────────────────
function WaterDayChart({ entries, goalMl, startTime, endTime }) {
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

  const ticks = [];
  for (let h = startH; h <= endH; h++) ticks.push(h);
  const sorted = [...entries].sort((a, b) => wtHhmmToDecimal(a.time) - wtHhmmToDecimal(b.time));
  let idx = 0, run = 0;
  const actual = ticks.map(h => {
    while (idx < sorted.length && wtHhmmToDecimal(sorted[idx].time) <= h) run += sorted[idx++].amountMl;
    return { h, v: run };
  });
  const expLine = ticks.map(h => `${xOf(h).toFixed(1)},${yOf(goalMl * (h - startH) / span).toFixed(1)}`).join(' ');
  const actLine = actual.map(p => `${xOf(p.h).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
  const base = (padTop + plotH).toFixed(1);
  const now = new Date();
  const nowDec = Math.max(startH, Math.min(endH, now.getHours() + now.getMinutes() / 60));
  const gridVals = [0, 0.5, 1].map(f => goalMl * f);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {gridVals.map((v, i) => (
        <g key={i}>
          {i > 0 && <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)} stroke={UI.hair} strokeWidth="0.5" strokeDasharray="3 3" />}
          <text x={padL - 5} y={(yOf(v) + 3).toFixed(1)} textAnchor="end" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{wtAmt(v)}</text>
        </g>
      ))}
      <line x1={padL} y1={base} x2={W - padR} y2={base} stroke={UI.hair} strokeWidth="0.5" />
      {ticks.filter((_, i) => i % Math.ceil(span / 6) === 0).map((h, i) => (
        <text key={i} x={xOf(h).toFixed(1)} y={H - 6} textAnchor="middle" fontSize="8" fontFamily={UI.fontNum} fill={UI.inkFaint}>{String(h).padStart(2, '0')}</text>
      ))}
      <line x1={xOf(nowDec).toFixed(1)} y1={padTop} x2={xOf(nowDec).toFixed(1)} y2={base} stroke={UI.inkFaint} strokeWidth="1" strokeDasharray="2 3" />
      <polyline points={expLine} fill="none" stroke={UI.gold} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.8" />
      <polygon points={`${xOf(startH).toFixed(1)},${base} ${actLine} ${xOf(actual[actual.length - 1].h).toFixed(1)},${base}`} fill={WT_BLUE_FAINT} />
      <polyline points={actLine} fill="none" stroke={WT_BLUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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

  const settings = store.settings || {};
  const goalMl = settings.waterGoalMl || 2000;
  const startTime = settings.waterStartTime || '08:00';
  const endTime = settings.waterEndTime || '22:00';
  const drinks = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks : []).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const coffeeSizes = ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes : WT_COFFEE_SIZES_DEFAULT).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const bottleEnabled = settings.waterBottleEnabled !== false;
  const bottleMl = settings.waterBottleMl || 1500;
  const today = wtDateStr(0);

  // Keep the user's UTC offset fresh so the reminder cron can place "now" on the
  // local ramp. Only writes when it actually changed (travel / DST).
  useEffectW(() => {
    const off = -new Date().getTimezoneOffset();
    if (settings.tzOffsetMinutes !== off) setStore(s => ({ ...s, settings: { ...s.settings, tzOffsetMinutes: off } }));
  }, []); // eslint-disable-line

  const todayEntries = useMemoW(
    () => (store.waterLogs || []).filter(l => l.date === today),
    [store.waterLogs, today],
  );
  const total = useMemoW(() => todayEntries.reduce((a, e) => a + (e.amountMl || 0), 0), [todayEntries]);
  const percent = Math.min(Math.round((total / goalMl) * 100), 100);
  const streak = useMemoW(() => wtStreak(store.dailyLogs, goalMl), [store.dailyLogs, goalMl]);

  const bottlesToday = (settings.waterBottlesDate === today) ? (settings.waterBottlesToday || 0) : 0;
  const plainToday = useMemoW(() => todayEntries.filter(e => !e.category).reduce((a, e) => a + e.amountMl, 0), [todayEntries]);
  const pendingBottle = bottleEnabled ? Math.max(0, plainToday - bottlesToday * bottleMl) : 0;

  const expected = wtExpectedMl(goalMl, startTime, endTime);
  const behind = total < expected - WT_BEHIND_ML;
  const missing = Math.max(200, Math.round(expected - total));

  const patchSettings = (patch) => setStore(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  // Writes the entry AND the recomputed day total into the daily log in one
  // atomic store update (both sync through syncStore; flushSync retries both).
  function patchDaily(s, dayEntries) {
    const sum = dayEntries.reduce((a, e) => a + (e.amountMl || 0), 0);
    const existing = (s.dailyLogs || []).find(l => l.date === today);
    const now = new Date().toISOString();
    const waterMl = sum > 0 ? sum : null;
    const log = existing
      ? { ...existing, waterMl, updatedAt: now }
      : { id: LB.uid(), date: today, weight: null, steps: null, calories: null, protein: null, carbs: null, fat: null, fiber: null, waterMl, note: null, offPlanNote: null, coachFields: null, adherence: null, targetsSnap: null, updatedAt: now, createdAt: now };
    return [log, ...(s.dailyLogs || []).filter(l => l.id !== log.id && l.date !== today)];
  }

  async function doAdd(amountMl, name, category) {
    const entry = { id: LB.uid(), date: today, time: wtNowHHMM(), amountMl: parseInt(amountMl, 10), name: name || null, category: category || null, createdAt: new Date().toISOString() };
    const prevTotal = total;
    setStore(s => {
      const nextLogs = [entry, ...(s.waterLogs || [])];
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, nextLogs.filter(l => l.date === today)) };
    });
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
      if (Math.max(0, nextPlain - bottlesToday * bottleMl) >= bottleMl) {
        if (!goalDialogShown) await new Promise(r => setTimeout(r, 300));
        const ok = await confirm(`You have logged ${bottleMl} ml of water via the quick amounts. Count an emptied bottle?`, { title: 'Bottle empty?', ok: 'Yes, empty', cancel: 'Not yet' });
        if (ok) setStore(s => ({ ...s, settings: { ...s.settings, waterBottlesToday: ((s.settings?.waterBottlesDate === today ? s.settings?.waterBottlesToday : 0) || 0) + 1, waterBottlesDate: today } }));
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
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, nextLogs.filter(l => l.date === today)) };
    });
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
    const grouped = {}; let milk = 0, custom = 0;
    todayEntries.forEach(e => {
      if (e.category === 'custom') { custom += e.amountMl; return; }
      if (e.category !== 'other') return;
      const mm = e.name ? e.name.match(/\+\s*(\d+)ml Milk/i) : null;
      if (mm) milk += parseInt(mm[1], 10);
      const baseName = (e.name || 'Other').replace(/\s*\+\s*\d+ml Milk/i, '');
      const key = coffeeSizes.some(s => s.label === baseName) ? 'Coffee' : baseName;
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return { grouped, milk, custom };
  }, [todayEntries, coffeeSizes]);

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Water" sub="Hydration" onBack={() => go({ name: 'home' })} right={
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStatsOpen(true)} aria-label="Stats" style={wtIconBtn}>
            <i className="fa-solid fa-chart-column" style={{ fontSize: 15 }} />
          </button>
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" style={wtIconBtn}>
            <i className="fa-solid fa-gear" style={{ fontSize: 15 }} />
          </button>
        </div>
      } />

      <div style={{ padding: '14px 22px 90px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Hero */}
        <BracketFrame gold style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
            <div>
              <div className="micro" style={{ color: UI.inkFaint }}>Today</div>
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
            <WaterRing percent={percent} />
          </div>
        </BracketFrame>

        {behind ? (
          <Frame accent style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: WT_BLUE_SOFT, background: WT_BLUE_FAINT }}>
            <i className="fa-solid fa-droplet" style={{ fontSize: 20, color: WT_BLUE }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: UI.ink, fontFamily: UI.fontUi }}>You are behind</div>
              <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>Drink about {wtAmt(missing)} {wtUnit()} to catch up</div>
            </div>
          </Frame>
        ) : total < goalMl ? (
          <div style={{ textAlign: 'center', fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi }}>On track. Keep sipping.</div>
        ) : null}

        {/* Quick amounts */}
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

        {/* Current bottle */}
        {bottleEnabled && pendingBottle > 0 && (
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

        {/* Other drinks: coffee preset spans the full row, user drinks below */}
        <div>
          <Bezel style={{ marginBottom: 10 }}>Other drinks</Bezel>
          <button onClick={openCoffee} style={{ ...wtDrinkTile, width: '100%', justifyContent: 'center' }}>
            <span style={wtDrinkIcon}><i className="fa-solid fa-mug-hot" style={{ fontSize: 15 }} /></span>
            <div style={{ textAlign: 'center', minWidth: 0 }}>
              <div style={wtDrinkName}>Coffee</div>
              <div style={wtDrinkMeta}>size + milk</div>
            </div>
          </button>
          {drinks.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
              {drinks.map((d, i) => (
                <button key={i} onClick={() => addWithConfirm(d.ml, d.name, 'other')} style={wtDrinkTile}>
                  <span style={wtDrinkIcon}><i className={`fa-solid ${d.icon || WT_DEFAULT_DRINK_ICON}`} style={{ fontSize: 15 }} /></span>
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

        <Btn kind="ghost" onClick={() => { setCustomMl(''); setCustomName(''); setCustomOpen(true); }} style={{ width: '100%' }}>
          <i className="fa-solid fa-plus" style={{ marginRight: 8 }} /> Custom entry
        </Btn>

        {/* Day chart */}
        <Card style={{ padding: 14 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Target vs actual</div>
          <WaterDayChart entries={todayEntries} goalMl={goalMl} startTime={startTime} endTime={endTime} />
        </Card>

        {/* Breakdown */}
        {(Object.keys(breakdown.grouped).length > 0 || breakdown.milk > 0 || breakdown.custom > 0 || bottlesToday > 0) && (
          <Card style={{ padding: 14 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Other drinks today</div>
            {bottleEnabled && bottlesToday > 0 && <WaterBreakdownRow icon="fa-bottle-water" name="Bottles" value={`${bottlesToday}x`} />}
            {Object.entries(breakdown.grouped).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <WaterBreakdownRow key={name} icon="fa-mug-hot" name={name} value={`${count}x`} />
            ))}
            {breakdown.milk > 0 && <WaterBreakdownRow icon="fa-cow" name="Milk" value={`${breakdown.milk} ml`} />}
            {breakdown.custom > 0 && <WaterBreakdownRow icon="fa-pen" name="Custom entries" value={`${breakdown.custom} ml`} />}
          </Card>
        )}

        {/* Today's log */}
        <div>
          <Bezel style={{ marginBottom: 10 }}>Today's entries ({todayEntries.length})</Bezel>
          {todayEntries.length === 0 ? (
            <div style={{ textAlign: 'center', fontSize: 12, color: UI.inkFaint, padding: '18px 0', fontFamily: UI.fontUi }}>Nothing logged yet today</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...todayEntries].sort((a, b) => wtHhmmToDecimal(b.time) - wtHhmmToDecimal(a.time)).map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                    <span className="num" style={{ fontSize: 12, color: WT_BLUE }}>{e.time}</span>
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
      </div>

      {/* ── Settings sheet ── */}
      {/* The drinks-config sub-sheet is a PUSH, not a stack: opening it closes
          the settings sheet and closing it reopens settings. Two Sheets open at
          once each run their own visualViewport keyboard handler, and both fire
          scrollIntoView on the focused field, which makes the view jump wildly
          on focus. One sheet open at a time keeps input focus calm. */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Water settings" titleColor="var(--accent)">
        <WaterSettingsBody settings={settings} patchSettings={patchSettings} go={go} onClose={() => setSettingsOpen(false)} onConfigureDrinks={() => { setSettingsOpen(false); setDrinksConfigOpen(true); }} />
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
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>No coffee sizes yet. Add your own in the water settings.</div>
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

function WaterBreakdownRow({ icon, name, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, fontFamily: UI.fontUi }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: UI.ink }}>
        <i className={`fa-solid ${icon}`} style={{ fontSize: 12, color: UI.inkFaint, width: 16, textAlign: 'center' }} />{name}
      </span>
      <span className="num" style={{ color: WT_BLUE, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// Settings body: goal, window, bottle tracker, reminders, custom drinks, coffee sizes.
function WaterSettingsBody({ settings, patchSettings, go, onClose, onConfigureDrinks }) {
  const [goal, setGoal] = useStateW(String(UI.waterToEntry(settings.waterGoalMl || 2000)));
  const [start, setStart] = useStateW(settings.waterStartTime || '08:00');
  const [end, setEnd] = useStateW(settings.waterEndTime || '22:00');
  const [bottleMlDraft, setBottleMlDraft] = useStateW(String(settings.waterBottleMl || 1500));
  const timeColorScheme = settings.darkMode === 'light' ? 'light' : 'dark';
  const timeStyle = { ...wtInput, colorScheme: timeColorScheme };

  const bottleEnabled = settings.waterBottleEnabled !== false;
  const reminderOn = !!settings.waterReminderEnabled;
  const pushOn = !!settings.pushEnabled;
  const drinkCount = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks.length : 0)
    + ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes.length : 0);

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
      {/* Goal + window */}
      <Field label={`Daily goal (${UI.waterEntryUnit()})`} style={{ marginBottom: 14 }}>
        <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^0-9]/g, ''))} onBlur={saveGoalWindow} type="text" inputMode="numeric" style={wtBigInput} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <Field label="Start time"><input type="time" value={start} onChange={e => setStart(e.target.value)} onBlur={saveGoalWindow} style={timeStyle} /></Field>
        <Field label="End time"><input type="time" value={end} onChange={e => setEnd(e.target.value)} onBlur={saveGoalWindow} style={timeStyle} /></Field>
      </div>

      {/* Bottle tracker */}
      <Bezel style={{ marginBottom: 12 }}>Bottle tracker</Bezel>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bottleEnabled ? 12 : 20 }}>
        <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>Count emptied bottles</span>
        <Toggle on={bottleEnabled} onToggle={() => patchSettings({ waterBottleEnabled: !bottleEnabled })} />
      </div>
      {bottleEnabled && (
        <Field label="Bottle size (ml)" style={{ marginBottom: 20 }}>
          <input value={bottleMlDraft} onChange={e => setBottleMlDraft(e.target.value.replace(/[^0-9]/g, ''))} onBlur={saveBottleMl} type="text" inputMode="numeric" style={wtInput} />
        </Field>
      )}

      {/* Reminders */}
      <Bezel style={{ marginBottom: 12 }}>Reminders</Bezel>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>Nudge me when I fall behind</span>
        <Toggle on={reminderOn} onToggle={() => patchSettings({ waterReminderEnabled: !reminderOn })} />
      </div>
      {reminderOn && !pushOn && (
        <button onClick={() => { onClose(); go({ name: 'settings' }); }} style={{ width: '100%', textAlign: 'left', fontSize: 12, color: UI.warn, fontFamily: UI.fontUi, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 4px' }}>
          Notifications are off. Turn them on in Settings to receive these.
        </button>
      )}
      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20, lineHeight: 1.5 }}>
        Uses your existing notification channel (Web Push or Pushover). Sent during your daily window.
      </div>

      {/* Other drinks & coffee live in their own sub-sheet to keep this one tidy */}
      <Bezel style={{ marginBottom: 12 }}>Drinks</Bezel>
      <button onClick={onConfigureDrinks} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '13px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', marginBottom: 20, WebkitTapHighlightColor: 'transparent' }}>
        <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi }}>Other drinks & coffee</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>{drinkCount > 0 ? `${drinkCount} set` : 'Configure'}</span>
          <ChevronRight color={UI.inkFaint} />
        </span>
      </button>

      <Btn onClick={() => { saveGoalWindow(); onClose(); }} style={{ width: '100%', marginTop: 4 }}>Done</Btn>
    </div>
  );
}

// Sub-sheet body: manage the up-to-6 custom drinks and the coffee sizes.
function WaterDrinksConfigBody({ settings, patchSettings, onClose }) {
  const drinks = (Array.isArray(settings.waterDrinks) ? settings.waterDrinks : []).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const coffee = ((settings.waterCoffeeSizes && settings.waterCoffeeSizes.length) ? settings.waterCoffeeSizes : WT_COFFEE_SIZES_DEFAULT).slice().sort((a, b) => (a.ml || 0) - (b.ml || 0));
  const [drinkName, setDrinkName] = useStateW('');
  const [drinkMl, setDrinkMl] = useStateW('');
  const [drinkIcon, setDrinkIcon] = useStateW(WT_DEFAULT_DRINK_ICON);
  const [cLabel, setCLabel] = useStateW('');
  const [cMl, setCMl] = useStateW('');

  const addDrink = () => {
    const entry = parseInt(drinkMl, 10);
    if (!drinkName.trim() || !entry || entry <= 0 || drinks.length >= WT_MAX_DRINKS) return;
    patchSettings({ waterDrinks: [...drinks, { name: drinkName.trim(), ml: UI.waterEntryToMl(entry), icon: drinkIcon }] });
    setDrinkName(''); setDrinkMl(''); setDrinkIcon(WT_DEFAULT_DRINK_ICON);
  };
  const removeDrink = (i) => patchSettings({ waterDrinks: drinks.filter((_, idx) => idx !== i) });
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
        {drinksLeft > 0 ? `Add up to ${drinksLeft} custom drink${drinksLeft === 1 ? '' : 's'}.` : 'You have added the maximum of 6 drinks.'}
      </div>
      {drinks.map((d, i) => (
        <WaterConfigRow key={i} left={d.name} right={`${wtAmt(d.ml)} ${wtUnit()}`} icon={d.icon || WT_DEFAULT_DRINK_ICON} onRemove={() => removeDrink(i)} />
      ))}
      {drinksLeft > 0 && (
        <div style={{ marginTop: 4, marginBottom: 20 }}>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>Icon</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
            {WT_DRINK_ICONS.map(ic => {
              const sel = drinkIcon === ic;
              return (
                <button key={ic} onClick={() => setDrinkIcon(ic)} aria-label={ic.replace('fa-', '')} style={{
                  display: 'grid', placeItems: 'center', padding: '10px 0', borderRadius: 6, cursor: 'pointer',
                  background: sel ? 'rgba(var(--accent-rgb),0.14)' : UI.bgInset,
                  border: `0.5px solid ${sel ? 'rgba(var(--accent-rgb),0.5)' : UI.hair}`,
                  color: sel ? 'var(--accent)' : UI.inkSoft, WebkitTapHighlightColor: 'transparent',
                }}>
                  <i className={`fa-solid ${ic}`} style={{ fontSize: 16 }} />
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 2 }}><TextInput value={drinkName} onChange={setDrinkName} placeholder="Name" /></div>
            <div style={{ flex: 1 }}>
              <input value={drinkMl} onChange={e => setDrinkMl(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder={wtUnit()} style={wtInput} />
            </div>
            <Btn onClick={addDrink} style={{ flexShrink: 0, minHeight: 40, padding: '10px 16px' }}>Add</Btn>
          </div>
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

function WaterConfigRow({ left, right, onRemove, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: WT_BLUE, width: 16, textAlign: 'center' }} />}
        {left}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{right}</span>
        <button onClick={onRemove} aria-label="Remove" style={{ background: 'transparent', border: 'none', color: UI.inkFaint, cursor: 'pointer', padding: 4, WebkitTapHighlightColor: 'transparent' }}>
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
  const timeColorScheme = store.settings?.darkMode === 'light' ? 'light' : 'dark';
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
    const rate = days.length ? Math.round((goalDays.length / days.length) * 100) : 0;
    let best = 0, cur = 0;
    days.forEach(d => { if (d.value >= goalMl) { cur++; best = Math.max(best, cur); } else cur = 0; });
    const drinks = {}; let milk = 0;
    (store.waterLogs || []).forEach(e => {
      if (e.date < range.from || e.date > range.to || e.category !== 'other') return;
      const mm = e.name ? e.name.match(/\+\s*(\d+)ml Milk/i) : null;
      if (mm) milk += parseInt(mm[1], 10);
      const baseName = (e.name || 'Other').replace(/\s*\+\s*\d+ml Milk/i, '');
      const key = coffeeLabels.includes(baseName) ? 'Coffee' : baseName;
      drinks[key] = (drinks[key] || 0) + 1;
    });
    const top = Object.entries(drinks).sort((a, b) => b[1] - a[1])[0];
    return { days, withData: withData.length, goalDays: goalDays.length, avg, rate, best, drinks, milk, fav: top ? top[0] : null, favN: top ? top[1] : 0 };
  }, [store.dailyLogs, store.waterLogs, range, goalMl, coffeeLabels]);

  const segBtn = (id, label) => (
    <button onClick={() => setPeriod(id)} style={{
      flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
      background: period === id ? 'var(--accent)' : 'transparent',
      color: period === id ? '#0a0805' : UI.inkFaint,
      fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
  const statCard = (label, value, sub) => (
    <div style={{ background: UI.bgInset, border: `1px solid ${UI.hair}`, borderRadius: 6, padding: '11px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 5 }}>{label}</div>
      <div className="num" style={{ fontSize: 19, color: UI.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}{sub && <span style={{ fontSize: 10, color: UI.inkFaint, marginLeft: 4, fontFamily: UI.fontUi }}>{sub}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${UI.hairStrong}`, marginBottom: 14 }}>
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
          {Object.entries(s.drinks).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <WaterBreakdownRow key={name} icon={name === 'Coffee' ? 'fa-mug-hot' : 'fa-glass-water'} name={name} value={`${count}x`} />
          ))}
          {s.milk > 0 && <WaterBreakdownRow icon="fa-cow" name="Milk" value={`${s.milk} ml`} />}
        </Card>
      )}
    </div>
  );
}

// ─── Local style constants ──────────────────────────────────────────
const wtIconBtn = {
  width: 34, height: 34, borderRadius: 4, border: `1px solid ${UI.hairStrong}`,
  background: 'transparent', color: UI.inkSoft, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  WebkitTapHighlightColor: 'transparent',
};
const wtTile = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '14px 6px 10px', borderRadius: 6, border: `1px solid ${UI.hairStrong}`,
  background: UI.bgInset, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
};
const wtDrinkTile = {
  display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 6,
  border: `1px solid ${UI.hairStrong}`, background: UI.bgInset, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', overflow: 'hidden',
};
const wtDrinkIcon = {
  width: 34, height: 34, borderRadius: 6, background: WT_BLUE_FAINT,
  border: `1px solid ${WT_BLUE_SOFT}`, display: 'grid', placeItems: 'center', color: WT_BLUE, flexShrink: 0,
};
const wtDrinkName = { fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const wtDrinkMeta = { fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 };
const wtInput = {
  background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
  color: UI.ink, fontFamily: UI.fontNum, fontSize: 16, padding: '10px 12px', width: '100%',
  WebkitAppearance: 'none',
};
const wtBigInput = { ...wtInput, fontSize: 22, padding: '12px 14px' };
const wtPreset = {
  padding: '10px 0', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, fontFamily: UI.fontNum, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
const wtPillOpt = {
  padding: '13px 8px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset,
  color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center',
  WebkitTapHighlightColor: 'transparent',
};

window.Screens = window.Screens || {};
Object.assign(window.Screens, { WaterScreen });
