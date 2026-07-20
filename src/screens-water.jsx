/* Water Tracker screen — a full hydration tracker ported from the standalone
   Wasser Tracker app into Zane. Per-entry logging (quick water amounts, named
   drinks, custom entries), a live activity ring, an expected-vs-actual day
   chart, a derived win streak, bottle counting, and a stats sheet.

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
const WT_BOTTLE_ML = 1500;               // one physical bottle
const WT_BEHIND_ML = 120;                // grace before the "you're behind" nudge

// Named drinks. ml=null opens the coffee size/milk flow. Everything else is a
// one-tap add under category 'other'.
const WT_DRINKS = [
  { name: 'Coffee',        icon: 'fa-mug-hot',       ml: null, coffee: true },
  { name: 'Energy Drink',  icon: 'fa-bolt',          ml: 250 },
  { name: 'Whey Shake',    icon: 'fa-blender',       ml: 300 },
  { name: '500ml Glass',   icon: 'fa-glass-water',   ml: 500 },
  { name: '650ml Glass',   icon: 'fa-glass-water',   ml: 650 },
  { name: 'Barbarian Jug', icon: 'fa-bottle-water',  ml: 1700 },
];
const WT_COFFEE_SIZES = [
  { label: 'Espresso', ml: 40 }, { label: 'Double', ml: 80 }, { label: 'Black', ml: 100 },
  { label: 'Barista', ml: 120 }, { label: 'Gran Lungo', ml: 150 }, { label: 'TGW', ml: 200 },
  { label: 'Mug', ml: 230 },
];
const WT_MILK_OPTS = [20, 40, 60, 80, 100, 0];
const WT_CUSTOM_PRESETS_ML = [100, 150, 200, 300, 330, 400, 750, 1000];
const WT_CELEBRATED_KEY = 'logbook-water-celebrated'; // per-device day guard for the success dialog

// Local YYYY-MM-DD for a day offset (0 = today). Local, not UTC, so it never
// slips a day near midnight.
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
// Display an ml amount as a whole running number in the viewer's unit (ml, or
// fl oz for lbs users) plus its label. Used for the hero, tiles and goal.
function wtAmt(ml) { return `${UI.waterToEntry(ml)}`; }
function wtUnit() { return UI.waterEntryUnit(); }

// Win streak derived purely from the daily-log history: consecutive days whose
// waterMl reached the goal, walking back from today. Today is allowed to be
// still in progress (if not yet met, the streak is measured from yesterday).
function wtStreak(dailyLogs, goalMl) {
  if (!goalMl) return 0;
  const byDate = {};
  (dailyLogs || []).forEach(l => { if (l.waterMl != null) byDate[l.date] = l.waterMl; });
  let streak = 0, offset = 0;
  if ((byDate[wtDateStr(0)] || 0) < goalMl) offset = -1; // today not done yet, keep prior run
  while ((byDate[wtDateStr(offset)] || 0) >= goalMl) { streak++; offset--; }
  return streak;
}

// The expected intake at "now" on a linear ramp between the start and end time.
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
  const startH = Math.floor(wtHhmmToDecimal(startTime));
  const endH = Math.ceil(wtHhmmToDecimal(endTime));
  const span = Math.max(1, endH - startH);
  const W = 320, padL = 40, padR = 12, padTop = 10, padBottom = 20, plotH = 96;
  const H = padTop + plotH + padBottom, plotW = W - padL - padR;
  const yMax = Math.max(goalMl, entries.reduce((a, e) => a + e.amountMl, 0)) * 1.05 || goalMl || 1;
  const xOf = h => padL + ((h - startH) / span) * plotW;
  const yOf = v => padTop + (1 - Math.min(v, yMax) / yMax) * plotH;

  // Hour ticks; cumulative actual up to each tick.
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
      {/* now marker */}
      <line x1={xOf(nowDec).toFixed(1)} y1={padTop} x2={xOf(nowDec).toFixed(1)} y2={base} stroke={UI.inkFaint} strokeWidth="1" strokeDasharray="2 3" />
      {/* target ramp */}
      <polyline points={expLine} fill="none" stroke={UI.gold} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.8" />
      {/* actual */}
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
  const [coffeeStep, setCoffeeStep] = useStateW('size'); // 'size' | 'milk'
  const [coffeeSize, setCoffeeSize] = useStateW(null);
  const [statsOpen, setStatsOpen] = useStateW(false);

  const settings = store.settings || {};
  const goalMl = settings.waterGoalMl || 2000;
  const startTime = settings.waterStartTime || '08:00';
  const endTime = settings.waterEndTime || '22:00';
  const today = wtDateStr(0);

  const todayEntries = useMemoW(
    () => (store.waterLogs || []).filter(l => l.date === today),
    [store.waterLogs, today],
  );
  const total = useMemoW(() => todayEntries.reduce((a, e) => a + (e.amountMl || 0), 0), [todayEntries]);
  const percent = Math.min(Math.round((total / goalMl) * 100), 100);
  const streak = useMemoW(() => wtStreak(store.dailyLogs, goalMl), [store.dailyLogs, goalMl]);

  const bottlesToday = (settings.waterBottlesDate === today) ? (settings.waterBottlesToday || 0) : 0;
  const plainToday = useMemoW(() => todayEntries.filter(e => !e.category).reduce((a, e) => a + e.amountMl, 0), [todayEntries]);
  const pendingBottle = Math.max(0, plainToday - bottlesToday * WT_BOTTLE_ML);

  const expected = wtExpectedMl(goalMl, startTime, endTime);
  const behind = total < expected - WT_BEHIND_ML;
  const missing = Math.max(200, Math.round(expected - total));

  // ── Mutations ──
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

  function doAdd(amountMl, name, category) {
    const entry = { id: LB.uid(), date: today, time: wtNowHHMM(), amountMl: parseInt(amountMl, 10), name: name || null, category: category || null, createdAt: new Date().toISOString() };
    const prevTotal = total;
    setStore(s => {
      const nextLogs = [entry, ...(s.waterLogs || [])];
      const dayEntries = nextLogs.filter(l => l.date === today);
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, dayEntries) };
    });
    // Crossed the goal this add? Celebrate once per day (per device).
    if (prevTotal < goalMl && prevTotal + entry.amountMl >= goalMl) {
      const seen = localStorage.getItem(WT_CELEBRATED_KEY);
      if (seen !== today) {
        localStorage.setItem(WT_CELEBRATED_KEY, today);
        const st = streak + ((store.dailyLogs || []).find(l => l.date === today && l.waterMl >= goalMl) ? 0 : 1);
        confirm(`You hit your ${wtAmt(goalMl)} ${wtUnit()} goal.${st > 1 ? ` ${st} days in a row, keep it flowing.` : ' Nice work, stay hydrated.'}`, { title: 'Goal reached', ok: 'Keep going', cancel: null });
      }
    }
    // Bottle prompt: a full bottle's worth of plain water piled up.
    if (!category) {
      const nextPlain = plainToday + entry.amountMl;
      if (Math.max(0, nextPlain - bottlesToday * WT_BOTTLE_ML) >= WT_BOTTLE_ML) {
        setTimeout(async () => {
          const ok = await confirm(`You have logged ${WT_BOTTLE_ML} ml of water via the quick amounts. Count an emptied bottle?`, { title: 'Bottle empty?', ok: 'Yes, empty', cancel: 'Not yet' });
          if (ok) setStore(s => ({ ...s, settings: { ...s.settings, waterBottlesToday: ((s.settings?.waterBottlesDate === today ? s.settings?.waterBottlesToday : 0) || 0) + 1, waterBottlesDate: today } }));
        }, 300);
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
      const dayEntries = nextLogs.filter(l => l.date === today);
      return { ...s, waterLogs: nextLogs, dailyLogs: patchDaily(s, dayEntries) };
    });
  }

  // Quick water amounts: ml for metric, fl oz (converted to ml) for imperial.
  const tiles = UI.waterInFloz()
    ? [8, 16, 24, 32].map(oz => ({ label: String(oz), ml: UI.flozToMl(oz) }))
    : [250, 500, 1000, 1500].map(ml => ({ label: String(ml), ml }));

  const openCoffee = () => { setCoffeeSize(null); setCoffeeStep('size'); setCoffeeOpen(true); };
  const confirmCoffee = (milkMl) => {
    setCoffeeOpen(false);
    const sz = WT_COFFEE_SIZES.find(s => s.ml === coffeeSize);
    const name = milkMl > 0 ? `${sz ? sz.label : 'Coffee'} + ${milkMl}ml Milk` : (sz ? sz.label : 'Coffee');
    addWithConfirm(coffeeSize + milkMl, name, 'other');
  };

  const submitCustom = () => {
    const amount = parseInt(customMl, 10);
    if (!amount || isNaN(amount) || amount <= 0) return;
    const ml = UI.waterInFloz() ? UI.flozToMl(amount) : amount;
    setCustomOpen(false);
    addWithConfirm(ml, customName.trim() || null, 'custom');
    setCustomMl(''); setCustomName('');
  };

  // Breakdown of today's non-plain drinks.
  const breakdown = useMemoW(() => {
    const drinks = {}; let milk = 0, custom = 0;
    todayEntries.forEach(e => {
      if (e.category === 'custom') { custom += e.amountMl; return; }
      if (e.category !== 'other') return;
      const mm = e.name ? e.name.match(/\+\s*(\d+)ml Milk/i) : null;
      if (mm) milk += parseInt(mm[1], 10);
      const base = (e.name || 'Other').replace(/\s*\+\s*\d+ml Milk/i, '');
      const key = WT_COFFEE_SIZES.some(s => s.label === base) ? 'Coffee' : base;
      drinks[key] = (drinks[key] || 0) + 1;
    });
    return { drinks, milk, custom };
  }, [todayEntries]);

  const timeColorScheme = settings.darkMode === 'light' ? 'light' : 'dark';
  const timeInputStyle = {
    background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
    color: UI.ink, fontFamily: UI.fontNum, fontSize: 16, padding: '10px 12px', width: '100%',
    colorScheme: timeColorScheme, WebkitAppearance: 'none',
  };

  return (
    <Screen>
      {confirmEl}
      <TopBar title="Water" sub="Hydration" onBack={() => go({ name: 'health' })} right={
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

        {/* Behind / on-track nudge */}
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
        {pendingBottle > 0 && (
          <Card style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i className="fa-solid fa-bottle-water" style={{ fontSize: 12, color: WT_BLUE }} /> Current bottle
              </span>
              <span className="num" style={{ fontSize: 12, color: UI.inkSoft }}>{pendingBottle} / {WT_BOTTLE_ML} ml</span>
            </div>
            <div style={{ height: 6, background: UI.bgInset, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.round(pendingBottle / WT_BOTTLE_ML * 100))}%`, background: WT_BLUE, borderRadius: 999, transition: 'width 0.5s' }} />
            </div>
          </Card>
        )}

        {/* Other drinks */}
        <div>
          <Bezel style={{ marginBottom: 10 }}>Other drinks</Bezel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {WT_DRINKS.map(d => (
              <button key={d.name} onClick={() => d.coffee ? openCoffee() : addWithConfirm(d.ml, d.name, 'other')} style={wtDrinkTile}>
                <span style={{ width: 34, height: 34, borderRadius: 6, background: WT_BLUE_FAINT, border: `1px solid ${WT_BLUE_SOFT}`, display: 'grid', placeItems: 'center', color: WT_BLUE, flexShrink: 0 }}>
                  <i className={`fa-solid ${d.icon}`} style={{ fontSize: 15 }} />
                </span>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                  <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 1 }}>{d.coffee ? '40 to 330 ml' : `${d.ml} ml`}</div>
                </div>
              </button>
            ))}
          </div>
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
        {(Object.keys(breakdown.drinks).length > 0 || breakdown.milk > 0 || breakdown.custom > 0 || bottlesToday > 0) && (
          <Card style={{ padding: 14 }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Other drinks today</div>
            {bottlesToday > 0 && <WaterBreakdownRow icon="fa-bottle-water" name="Bottles" value={`${bottlesToday}x`} />}
            {Object.entries(breakdown.drinks).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
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
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Water settings" titleColor="var(--accent)">
        <WaterSettingsBody settings={settings} setStore={setStore} timeInputStyle={timeInputStyle} onClose={() => setSettingsOpen(false)} />
      </Sheet>

      {/* ── Custom entry sheet ── */}
      <Sheet open={customOpen} onClose={() => setCustomOpen(false)} title="Custom entry" titleColor="var(--accent)">
        <Field label={`Amount (${wtUnit()})`} style={{ marginBottom: 14 }}>
          <input value={customMl} onChange={e => setCustomMl(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" placeholder={wtUnit()} autoFocus
            style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, color: UI.ink, fontFamily: UI.fontNum, fontSize: 22, padding: '12px 14px', width: '100%' }} />
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {WT_COFFEE_SIZES.map(s => (
              <button key={s.label} onClick={() => { setCoffeeSize(s.ml); setCoffeeStep('milk'); }} style={wtPillOpt}>
                {s.label}<span style={{ fontSize: 10, color: UI.inkFaint, display: 'block', marginTop: 2 }}>{s.ml} ml</span>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: UI.inkSoft, marginBottom: 14, fontFamily: UI.fontUi }}>Base {coffeeSize} ml. How much milk?</div>
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

// Settings body: goal + daily window. Local draft, saved into the store.
function WaterSettingsBody({ settings, setStore, timeInputStyle, onClose }) {
  const [goal, setGoal] = useStateW(String(UI.waterToEntry(settings.waterGoalMl || 2000)));
  const [start, setStart] = useStateW(settings.waterStartTime || '08:00');
  const [end, setEnd] = useStateW(settings.waterEndTime || '22:00');
  const save = () => {
    const entry = parseInt(goal, 10);
    const ml = entry > 0 ? (UI.waterInFloz() ? UI.flozToMl(entry) : entry) : 2000;
    setStore(s => ({ ...s, settings: { ...s.settings, waterGoalMl: ml, waterStartTime: start, waterEndTime: end } }));
    onClose();
  };
  return (
    <div>
      <Field label={`Daily goal (${UI.waterEntryUnit()})`} style={{ marginBottom: 16 }}>
        <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric"
          style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, color: UI.ink, fontFamily: UI.fontNum, fontSize: 22, padding: '12px 14px', width: '100%' }} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <Field label="Start time"><input type="time" value={start} onChange={e => setStart(e.target.value)} style={timeInputStyle} /></Field>
        <Field label="End time"><input type="time" value={end} onChange={e => setEnd(e.target.value)} style={timeInputStyle} /></Field>
      </div>
      <Btn onClick={save} style={{ width: '100%' }}>Save</Btn>
    </div>
  );
}

// Stats body: last 30 days of daily water totals from the daily log history.
function WaterStatsBody({ store, goalMl }) {
  const days = useMemoW(() => {
    const byDate = {};
    (store.dailyLogs || []).forEach(l => { if (l.waterMl != null) byDate[l.date] = l.waterMl; });
    const out = [];
    for (let i = 29; i >= 0; i--) { const d = wtDateStr(-i); out.push({ date: d, total: byDate[d] || 0 }); }
    return out;
  }, [store.dailyLogs]);
  const withData = days.filter(d => d.total > 0);
  const met = days.filter(d => d.total >= goalMl);
  const avg = withData.length ? Math.round(withData.reduce((a, d) => a + d.total, 0) / withData.length) : 0;
  const rate = withData.length ? Math.round((met.length / withData.length) * 100) : 0;
  const best = wtStreak(store.dailyLogs, goalMl);
  const maxV = Math.max(goalMl, ...days.map(d => d.total)) || 1;

  return (
    <div>
      <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Last 30 days</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, marginBottom: 20 }}>
        {days.map(d => (
          <div key={d.date} title={`${d.date}: ${d.total} ml`} style={{ flex: 1, height: `${Math.round(d.total / maxV * 100)}%`, minHeight: d.total > 0 ? 2 : 0, background: d.total >= goalMl ? WT_BLUE : WT_BLUE_SOFT, borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><SubDial label="Current streak" value={`${best}`} sub="days" gold /></div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><SubDial label="Goal hit" value={`${rate}%`} /></div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><SubDial label="Avg / day" value={`${avg}`} sub="ml" /></div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><SubDial label="Days logged" value={`${withData.length}`} sub="days" /></div>
      </div>
    </div>
  );
}

// ─── Local style constants (inside module scope, not global collisions) ──
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
