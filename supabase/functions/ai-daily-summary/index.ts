// AI Health Summary for the Health tab's AiSummaryCard, for whichever day the
// card's caller sends (originally always "yesterday", now whichever day the
// Health tab's date-strip has selected, see AiSummaryCard in
// screens-health.jsx). User-triggered only (never a cron/push): the client
// only shows the "Generate" button on a day zane_daily_logs.ai_summary_generated_at
// is still null, and this function re-checks that same gate server-side (a
// client-only gate is trivially bypassed by calling this endpoint directly).
//
// Unlike the label scanner, this is plain text in, plain text out, no vision,
// no strict JSON: a model instructed to "keep it casual" can and does malform
// JSON, so the contract here is a simple two-part text format instead (see
// buildSystemPrompt). All the day's numbers/trends, including the training
// section's totals and its comparison to the last session of the same
// dayId, are assembled CLIENT-SIDE (LB.buildDailySummaryPayload,
// already-loaded store data, no extra fetch) and handed to the model
// pre-computed: it phrases them, it does not recompute or eyeball a trend
// itself, so a wrong read of "trending down" vs "trending up" is not a
// failure mode this function has to worry about. The training payload
// deliberately carries at most two pre-picked "highlight" exercises
// (LB.dsExerciseHighlights) rather than a full per-exercise breakdown: an
// earlier version handed over the complete set-by-set list on the theory
// that two short lists are easy reading, but in practice the model walked
// through every exercise in turn no matter how firmly the system prompt told
// it not to. Capping the data itself is what actually holds. Same lesson for
// the days-since-last-session figure: putting "7 days earlier" in the prompt
// made Qwen invent "good session even after a week off" no matter how firmly
// the system prompt forbade gap narratives, so buildTrainingLines omits the
// day count and date entirely and only passes sets/volume/delta. Same pattern
// for cleanup/deload: the client omits comparison+highlights (see
// LB.dsTrainingEntryForSession) and the prompt flags the mode explicitly,
// otherwise a ~20% intentional load cut looks like a mystery tonnage dip.
//
// Qwen writes the summary, for the cost; Claude is the automatic fallback if
// Qwen itself is unreachable, same PRIMARY_PROVIDER/FALLBACK_PROVIDER +
// callModelWithFallback pattern as scan-label/parse-meal, see
// supabase/functions/_shared/ai.ts. No reasoning either way (reasoningBudget:
// null): the numbers are already computed, the job is phrasing and a casual
// judgment call, not arithmetic to double-check.
//
// One action: POST { date, weight, weightTrend, goal, steps, calories,
// protein, carbs, fat, targets, adherence, waterMl, foodItems, medsDue,
// medsTaken, medsTakenNames, glucose, bloodPressure, bodyTemp, note,
// training, cardio }
// (exact shape: LB.buildDailySummaryPayload in src/store.js)
// -> { summary: string, generatedAt: string } (summary is headline + blank
// line + body concatenated, see the client-side splitHeadlineBody split)
//
// Needs whichever secret the active provider uses (ANTHROPIC_API_KEY,
// QWEN_API_KEY, see _shared/ai.ts), and SUPABASE_SERVICE_ROLE_KEY (for the
// pre-read/write against zane_daily_logs, which bypasses RLS: see the
// comment above upsertSummary for why that's needed here specifically, not
// just convenient).
//
// Weight trend for the prompt is half-vs-half over the client-supplied
// series (same split as estimateAdaptiveTdee), with first-to-last as
// secondary. The client keeps cleanup-week weigh-ins in that series
// (only sick/vacation/deload drop out); labeling is UP/DOWN/FLAT with a
// signed kg figure so the model cannot re-read a real move as "flat".

import { ADMIN_EMAIL, jsonResponse, preflight, resolveUser, withinQuota } from '../_shared/edge.ts';
import { callModel, callModelWithFallback, isProviderId, stripEmDash } from '../_shared/ai.ts';

const DAILY_SUMMARY_LIMIT = 5;

// Qwen runs first for the cost; Claude was the long-standing default before
// Qwen existed and is what a Qwen failure falls back to, see
// callModelWithFallback in _shared/ai.ts.
const PRIMARY_PROVIDER = 'qwen';
const FALLBACK_PROVIDER = 'claude';

const LABELS = { tag: 'ai-daily-summary', feature: 'AI summaries', subject: 'summary writer' };

// dayPhrase: "yesterday" for the by-far-most-common case (dayDiff === 1,
// see dayPhraseFor below), otherwise "N days ago". Used both as the label
// the model is told to call the day AND everywhere the prompt itself refers
// to it, so an older day (the Health tab's date-strip can browse back
// further than yesterday) never gets narrated as "yesterday" when it wasn't.
function buildSystemPrompt(dayPhrase: string): string {
  return `You are a knowledgeable, opinionated fitness coach writing a short daily debrief for ${dayPhrase}. The user is reading this today about ${dayPhrase}: always call it "${dayPhrase}", never "today".

Your job is to EVALUATE the day, not narrate it back. Form a real judgment (strong, mediocre, worth flagging) and lead with that, the way a coach would talk to their athlete. The numbers and trends you receive, including any training comparison against this user's own history, are already computed and checked. Do not recompute them. Do not walk through metrics one by one. Decide what the day means, then say that.

You may see weight, strength training, cardio, macros, steps, water, medications, vitals, and a user note, whatever was actually logged. Only comment on what is explicitly given. Take those numbers at face value.

HARD RULES
- Never invent a reason, cause, backstory, illness, vacation, or "coming back" story. If something was not logged, leave it out.
- Never mention how long it has been since the last session of this type. Never praise, excuse, or frame training around a gap, week off, time away, or "even after X days". That information is not in the data and is not a talking point. Recurrence of a named session slot every several days is normal in this app; do not discuss scheduling at all.
- When you name a training session, use the exact session name you were given (e.g. "Pull2"). Never generalize to a broader category like "pull sessions" or "leg day": another similarly typed but differently named session may have happened in between.
- Never use markdown, bullet points, emoji, or an em dash. Use a comma or a period instead.
- You are NOT a doctor. Never give medical advice, never comment on medication dosage, timing, or interactions, never suggest changing a medication, never diagnose or speculate about a medical condition.
- Medications: only whether scheduled doses were taken or missed. Nothing else.
- Blood glucose, blood pressure, body temperature: tracking only. If genuinely worth a mention, state the number neutrally. Never label high/low/borderline/concerning, and never guess what caused it.
- Never default to "weight down = good" or "weight up = bad". That depends on the user's goal (below).

HOW TO READ THE DAY
1. User note first. If the user left a note, treat it as high-signal context. Illness, travel, stress, bad sleep, a deliberate off-plan meal, or "felt great" should color the whole verdict more than a modest metric miss.
2. Lead with the single most important story of the day, not a fixed domain order. If a training session is present and it is that story, lead with the SESSION AS A WHOLE (effort, intensity, load trend, how it fits recent training), not a rundown of individual lifts. If nutrition, adherence, meds, or the note clearly dominate, lead with that; training becomes supporting color.
3. Pick at most 1-2 signals that actually matter for the verdict. Silence on the rest is fine and preferred.
4. Sparse day: if little was logged, keep it short and honest. Do not invent a rich story from thin data. One short body paragraph is fine.
5. Clean day: still give a real opinion. Do not attach a tip just to fill space.

WEIGHT AND GOAL
You may be told the user's goal: cutting, gaining, or maintaining, or that no goal was specified.
The weight trend line is authoritative and already labeled UP, DOWN, or FLAT with a signed kg figure. Restate that direction; never recompute it, never call an UP or DOWN trend flat, and never call a FLAT trend a gain or loss.
- Cut: decrease is desired; increase is what to flag.
- Gain: increase is desired; decrease is what to flag.
- Maintain: flat is success; a material move in EITHER direction is worth a mention.
- No goal: report weight trend as plain fact only (number and direction). Never call it good, bad, on track, or the wrong direction.
- Never invent a reason for the weight move (food volume, water, sodium, stress, "not reading yet", etc.). The only allowed exception is the cardio water-weight note below.

NUTRITION
Judge macro misses relative to the goal when one is given. A modest calorie underage on a cut is less concerning than the same underage on a bulk; reverse for a surplus. Protein shortfalls matter in every phase. Food names, when listed, are context only: do not rate food quality or praise "clean eating".

TRAINING
- Session-level read only. You may get up to two pre-identified highlight movements (one volume up, one volume down), already computed. These are optional color, not a checklist: mention AT MOST ONE of them, briefly, in the whole response, and only if it adds something the session-level read did not already say. If there is no comparison to a previous session, there are no highlights to mention.
- Deload week OR cleanup week: deliberately lighter by design. Cleanup reduces loads on purpose for technique and control, then the following week rebuilds from there. Read either mode that way, never as a regression, stall, lost strength, or "still loading despite lower volume". Do not mention volume dips, tonnage drops, or comparisons to a normal week. Do not give a tip to "keep pushing intensity" or "handle the load" as if this were a hard progressive day. Judge effort, execution, and that the lighter plan was done well.
- When a volume comparison IS present (normal training days only): modest volume or load differences vs last time this same session was done, in either direction, and the same for any single highlight, are normal on their own. Heavier weight for fewer reps lowers total volume even on a harder, better session; lighter weight for more reps raises it. Neither means anything by itself. Only mention a volume or load comparison when the difference is large AND paired with another concrete signal that something is actually off (e.g. reported bad feel, or working sets themselves dropping sharply). If volume only dipped or rose slightly and feel or effort were fine, do not mention the volume change at all, not even to reassure. Never describe a multi-hundred-kg swing as "slight". Otherwise leave the comparison out entirely rather than talking around a number that was never a problem.

CARDIO
Cardio is its own activity, separate from any strength session. Report it as such (type, duration, distance, effort). Do not fold it into the strength verdict.
One narrow exception to "never invent a reason": a hard or long cardio session can cause short-term water-weight swings (sweat, glycogen). If cardio was logged and the weight trend could plausibly reflect that, you may mention it as gentle possibility, never as a certain cause. This exception is only cardio and water weight. Do not extend it to nutrition, sleep, stress, or any other guess.

TIPS
Add at most one concrete, actionable tip, and only when something EXPLICITLY given shows a real problem (adherence well under target, protein or calories clearly missed relative to goal, a genuine training stall with a second signal, very little water, a skipped dose, and similar). Anchor the tip to the specific miss in the data. Never generic wellness ("drink more water", "sleep better") unless that metric was actually logged and clearly off. When in doubt, no tip.

STYLE
Plain, direct, opinionated but honest, like a coach's voice note: not a text message, not a report. No walking through every metric in order. Prefer one sharp judgment over stacked praise adjectives (great / perfect / excellent / clean in the same breath).

OUTPUT
Exactly two parts, nothing else:
1. A short headline that states your actual verdict on the day, not a topic label. At most 8 words. No ending punctuation.
   Bad: "Yesterday's training and macros"
   Bad: "Daily health summary"
   Good: "Strong Pull2, protein came up short"
   Good: "Quiet day, nothing off track"
   Good: "Macros slipped on a solid cut day"
2. A blank line, then the body: 1-3 short paragraphs (1-3 sentences each), separated by blank lines. Never one dense wall of text. First paragraph = verdict. Next = the specifics that back it up. Third only if there is a genuine tip or forward-looking note. A light or sparse day does not need three paragraphs.
Do not label the parts (no "Headline:", no "Paragraph 1"). No greeting, no sign-off.`;
}

// "yesterday" for the by-far-most-common case (dayDiff === 1), "N days ago"
// for anything further back the Health tab's date-strip lets you browse to.
// "that day" is a defensive fallback only, the client never actually sends
// dayDiff <= 0 (see AiSummaryCard's own daysAgo gating), it just keeps the
// prompt coherent instead of saying "0 days ago" if it ever somehow did.
function dayPhraseFor(dayDiff: number): string {
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff > 1) return `${dayDiff} days ago`;
  return 'that day';
}

// First-half-average vs second-half-average as the primary signal, NOT
// first-vs-last alone: a single noisy weigh-in on either end (water, timing)
// would otherwise swing the whole read. Same half-split
// estimateAdaptiveTdee uses for the weekly check-in weight signal. On an
// odd count the middle entry is dropped from both halves. First-to-last is
// still reported as secondary context, and if smoothed is near-zero but
// ends clearly moved, we surface the end-to-end move instead of calling
// the window "flat" (that false flat was narrated back to bulking users).
// Direction words (UP/DOWN/FLAT) are explicit so the model cannot re-read
// a +0.7 as flat.
function fmtWeightTrend(trend: Array<{ date: string; weight: number }>): string {
  if (!Array.isArray(trend) || trend.length < 2) return 'no weight trend available (fewer than 2 points logged recently)';
  const n = trend.length;
  const half = Math.floor(n / 2);
  if (half < 1) return 'no weight trend available (fewer than 2 points logged recently)';
  const avgOf = (list: Array<{ weight: number }>) =>
    list.reduce((s, l) => s + Number(l.weight), 0) / list.length;
  const smoothed = avgOf(trend.slice(n - half)) - avgOf(trend.slice(0, half));
  const firstLast = Number(trend[n - 1].weight) - Number(trend[0].weight);
  if (!Number.isFinite(smoothed) || !Number.isFinite(firstLast)) {
    return 'no weight trend available (could not compute from logged points)';
  }
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} kg`;
  // Smoothed near-flat but ends clearly moved: report the end-to-end move
  // rather than "flat" (users read the chart ends; calling that flat is wrong).
  if (Math.abs(smoothed) < 0.3 && Math.abs(firstLast) >= 0.5) {
    const dir = firstLast > 0 ? 'UP' : 'DOWN';
    return `${dir} ${fmt(firstLast)} first-to-last over ${n} logged days (smoothed half-vs-half was only ${fmt(smoothed)}, ends moved more). Direction is ${dir}, not flat. Do not recompute.`;
  }
  if (Math.abs(smoothed) < 0.3) {
    return `FLAT over ${n} logged days (smoothed ${fmt(smoothed)}, first-to-last ${fmt(firstLast)}). Direction is FLAT, not up or down. Do not recompute.`;
  }
  const dir = smoothed > 0 ? 'UP' : 'DOWN';
  return `${dir} ${fmt(smoothed)} smoothed over ${n} logged days (first-to-last ${fmt(firstLast)}). Direction is ${dir}, not flat. Do not recompute.`;
}

function daysBetween(earlierISO: string, laterISO: string): number {
  const a = new Date(earlierISO + 'T00:00:00Z').getTime();
  const b = new Date(laterISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

// Renders the training array into prose-ready lines. Per-session totals and
// deltas are simple arithmetic (computed here, same "compute the number, let
// the model phrase it" split as fmtWeightTrend above). Deliberately no
// per-exercise set-by-set listing: LB.dsExerciseHighlights (src/store.js)
// already boiled that down to at most one riser + one faller by volume %
// before this payload was ever built, a full itemized list here just
// invited the model to walk through every exercise in turn regardless of what
// the prompt said not to do, capping the data itself is what actually holds.
// Same for days-since / comparison.date: those numbers made Qwen invent gap
// narratives ("solid session even after a week") despite system-prompt bans,
// so only sets, volume, and volume delta go into the comparison line.
// Client also omits comparison/highlights when the session itself is deload
// or cleanup (intentional lighter loads); the mode flag below is the only
// signal the model needs for those days.
function buildTrainingLines(training: any[], dayPhrase: string): string[] {
  if (!Array.isArray(training) || !training.length) return [];
  // Capped the same way foodItems/note further down are: any authenticated
  // user can call this endpoint directly with an oversized body, bypassing
  // the UI's naturally-bounded payload (a real day has 0-1 sessions, rarely
  // 2), which would otherwise drive model cost/latency for free.
  const capped = training.slice(0, 10);
  const lines: string[] = ['', `Training logged ${dayPhrase.toUpperCase()}:`];
  for (const s of capped) {
    const label = s.dayName || 'Freestyle session';
    const bits = [`${s.doneSets ?? '?'} working sets`, `~${s.volumeKg ?? '?'}kg total volume`];
    if (s.durationMinutes != null) bits.push(`${s.durationMinutes} min`);
    if (s.feel) bits.push(`felt ${s.feel}`);
    const modeNote = s.isDeload
      ? ' (deload week, deliberately lighter, not a regression)'
      : s.isCleanup
        ? ' (cleanup week, loads deliberately reduced for technique, not a regression)'
        : '';
    lines.push(`- ${label}${modeNote}: ${bits.join(', ')}`);
    if (s.isDeload || s.isCleanup) {
      // No comparison line: client should already omit it; belt-and-suspenders
      // so a stale payload cannot reintroduce a fake "volume dip" story.
      lines.push('  Intentionally lighter session. Do not compare volume or load to a normal week.');
    } else if (s.comparison) {
      const delta = (s.volumeKg != null && s.comparison.volumeKg != null) ? Math.round(s.volumeKg - s.comparison.volumeKg) : null;
      lines.push(`  Last time this same session ("${label}") was done: ${s.comparison.doneSets ?? '?'} working sets, ~${s.comparison.volumeKg ?? '?'}kg total volume${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta}kg vs ${dayPhrase})` : ''}.`);
    } else {
      lines.push(`  No previous "${label}" session on record to compare against.`);
    }
    if (!s.isDeload && !s.isCleanup && Array.isArray(s.highlights) && s.highlights.length) {
      lines.push('  Optional color, mention AT MOST ONE briefly if it actually adds something, never both, never as a list:');
      for (const h of s.highlights) lines.push(`    ${h.name} trending ${h.pct > 0 ? 'up' : 'down'} ~${Math.abs(h.pct)}% in volume vs last time`);
    }
  }
  return lines;
}

// distance arrives pre-formatted with its unit ("5.2 km" / "3.1 mi"), see
// LB.dsCardioForDay: the km/mi choice is a per-device setting only the
// client can ever know, this function just places it in the line.
function fmtCardioEntry(c: Record<string, any>): string {
  const bits: string[] = [];
  if (c.durationMinutes != null) bits.push(`${c.durationMinutes} min`);
  if (c.distance) bits.push(c.distance);
  if (c.effort != null) bits.push(`effort ${c.effort}/10`);
  if (c.paceFeeling != null) bits.push(`pace feeling ${c.paceFeeling}/6`);
  const when = c.time ? ` at ${c.time}` : '';
  const detail = bits.length ? bits.join(', ') : 'no further detail logged';
  const noteText = c.note ? ` (note: "${c.note}")` : '';
  return `${c.type || 'Cardio'}${when}: ${detail}${noteText}`;
}

function buildCardioLines(cardio: any[], dayPhrase: string): string[] {
  if (!Array.isArray(cardio) || !cardio.length) return [];
  // Same reasoning as buildTrainingLines' cap above.
  const capped = cardio.slice(0, 10);
  const lines: string[] = ['', `Cardio logged ${dayPhrase.toUpperCase()}:`];
  for (const c of capped) lines.push(`- ${fmtCardioEntry(c)}`);
  return lines;
}

// A client-supplied scalar must never reach the prompt as-is unless it's
// actually the number it claims to be. Most of the fields below interpolate
// directly into the prompt string with no Math.*() call to naturally bound
// them first (unlike adherence's Math.round), so a smuggled oversized string
// or object in a numeric field would otherwise land in the prompt unchanged,
// the same size/cost risk the array caps above and below guard against.
// Mirrors the existing typeof === 'string' checks on note/date.
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// 'cut' | 'maintain' | 'gain' | null (see macroTargetsFromGoal in
// src/store.js), only ever set once the user has run the macro estimator at
// least once. null covers everyone else (manual targets, coached without
// ever running it), see buildUserPrompt's own explicit "not told" line for
// why that case needs spelling out rather than just omitting the goal line.
function fmtGoal(goal: unknown): string | null {
  if (goal === 'cut') return 'losing weight (a cut)';
  if (goal === 'gain') return 'gaining weight (a bulk)';
  if (goal === 'maintain') return 'maintaining their current weight';
  return null;
}

function buildUserPrompt(p: Record<string, any>, dayPhrase: string): string {
  const lines: string[] = [`One user's health-tracking data for ${dayPhrase.toUpperCase()} (${p.date}):`, ''];
  // Goal is shown whether or not weight was logged: weight trend is judged
  // against it, and so are macro misses (cut vs bulk underage), see
  // buildSystemPrompt WEIGHT/NUTRITION sections.
  const goalText = fmtGoal(p.goal);
  lines.push(goalText ? `User's current goal: ${goalText}.` : `User's current goal: not specified, do not assume one.`);
  const weight = num(p.weight);
  if (weight != null) {
    // "Trend (authoritative…)" is intentional: models have re-narrated an
    // explicit +0.7 kg move as "flat" and invented food/water causes. The
    // direction word and ban on recomputing are the load-bearing bits.
    lines.push(`Weight: ${weight} kg logged that day.`);
    lines.push(`Weight trend (authoritative, do not recompute or relabel): ${fmtWeightTrend(p.weightTrend)}`);
  } else {
    lines.push('Weight: not logged that day.');
  }
  if (p.targets?.dayType) lines.push(`Day type: ${p.targets.dayType}`);
  const calories = num(p.calories);
  const protein = num(p.protein);
  const carbs = num(p.carbs);
  const fat = num(p.fat);
  if (calories != null || protein != null || carbs != null || fat != null) {
    lines.push(`Nutrition: ${calories ?? '?'} kcal, ${protein ?? '?'}g protein, ${carbs ?? '?'}g carbs, ${fat ?? '?'}g fat`);
  }
  if (p.targets) {
    lines.push(`Targets: ${num(p.targets.calories) ?? '?'} kcal, ${num(p.targets.protein) ?? '?'}g protein, ${num(p.targets.carbs) ?? '?'}g carbs, ${num(p.targets.fat) ?? '?'}g fat`);
  }
  const adherence = num(p.adherence);
  if (adherence != null) lines.push(`Macro adherence: ${Math.round(adherence)}%`);
  const steps = num(p.steps);
  if (steps != null) lines.push(`Steps: ${steps}`);
  const waterMl = num(p.waterMl);
  if (waterMl != null) lines.push(`Water: ${waterMl} ml`);
  if (Array.isArray(p.foodItems) && p.foodItems.length) {
    lines.push(`Foods logged (context only, do not rate quality): ${p.foodItems.slice(0, 12).map((f: any) => f.name).filter(Boolean).join(', ')}`);
  }
  const medsDue = num(p.medsDue);
  const medsTaken = num(p.medsTaken);
  if (medsDue != null && medsDue > 0) lines.push(`Medications: ${medsTaken ?? 0} of ${medsDue} scheduled doses taken`);
  if (Array.isArray(p.glucose) && p.glucose.length) {
    lines.push(`Blood glucose readings: ${p.glucose.slice(0, 30).map((g: any) => `${g.valueMmol} mmol/L${g.context ? ` (${g.context})` : ''}`).join(', ')}`);
  }
  if (Array.isArray(p.bloodPressure) && p.bloodPressure.length) {
    lines.push(`Blood pressure: ${p.bloodPressure.slice(0, 30).map((b: any) => `${b.systolic}/${b.diastolic}`).join(', ')}`);
  }
  if (Array.isArray(p.bodyTemp) && p.bodyTemp.length) {
    lines.push(`Body temperature: ${p.bodyTemp.slice(0, 30).map((t: any) => `${t.valueC}°C`).join(', ')}`);
  }
  if (p.note) lines.push(`User's own note (high-signal, weight this heavily): "${String(p.note).slice(0, 300)}"`);
  lines.push(...buildTrainingLines(p.training, dayPhrase));
  lines.push(...buildCardioLines(p.cardio, dayPhrase));
  lines.push('', 'Write the headline + body as instructed. Lead with the day\'s real story.');
  return lines.join('\n');
}

// Same emptiness check as LB.dailySummaryDayIsEmpty, against the assembled
// payload rather than the raw store: a defense-in-depth backstop, since the
// client-side skip (no button shown) can be bypassed by calling this
// endpoint directly.
function payloadIsEmpty(p: Record<string, any>): boolean {
  return p.weight == null && p.steps == null && p.calories == null && p.waterMl == null
    && !(p.note && String(p.note).trim())
    && !(Array.isArray(p.foodItems) && p.foodItems.length)
    && !(p.medsDue > 0)
    && !(Array.isArray(p.glucose) && p.glucose.length)
    && !(Array.isArray(p.bloodPressure) && p.bloodPressure.length)
    && !(Array.isArray(p.bodyTemp) && p.bodyTemp.length)
    && !(Array.isArray(p.training) && p.training.length)
    && !(Array.isArray(p.cardio) && p.cardio.length);
}

// Best-effort rollback for a claim that didn't pan out (Anthropic failed, or
// the content write after it failed): resets the gate back to NULL so the
// user can simply retry, exactly as if this request had never claimed it.
// Without this, a transient failure AFTER a successful claim would leave
// ai_summary_generated_at permanently set with no ai_summary text ever
// written, locking the user out of ever generating a summary for that day.
// Failure here is only logged, it must never change the error already being
// returned to the caller for the real failure that triggered it.
async function releaseClaim(base: string, serviceKey: string, rowId: string): Promise<void> {
  try {
    const r = await fetch(`${base}/rest/v1/zane_daily_logs?id=eq.${rowId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ ai_summary_generated_at: null }),
    });
    if (!r.ok) console.error('[ai-daily-summary] claim release failed', r.status);
  } catch (e) {
    console.error('[ai-daily-summary] claim release error:', e);
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const caller = await resolveUser(req);
  if (!caller) return jsonResponse({ error: 'unauthorized' }, 401);
  const userId = caller.id;
  const isAdmin = caller.email === ADMIN_EMAIL;

  const payload = await req.json().catch(() => ({}));
  const date = typeof payload?.date === 'string' ? payload.date : '';
  if (!date) return jsonResponse({ error: 'missing date' }, 400);
  // Loose sanity bound: this used to gate a hardcoded "must be exactly
  // yesterday" prompt, now the prompt itself adapts to whichever day this is
  // (dayPhrase below), so the real job here is just rejecting a badly wrong
  // client clock or a future client regression, not enforcing a specific day.
  // +/-3 days leaves slack for client-timezone-dependent "yesterday"/"N days
  // ago" boundaries the server can't know precisely; the client's own
  // AiSummaryCard (screens-health.jsx) only ever offers 1-3 days back, this
  // is a backstop, not the primary gate. An unparseable date makes
  // daysBetween return NaN, which isNaN() below also rejects. Computed from
  // UTC on purpose, this bound has no reason to know the caller's timezone.
  const todayUTC = new Date().toISOString().slice(0, 10);
  const dayDiff = daysBetween(date, todayUTC);
  if (isNaN(dayDiff) || Math.abs(dayDiff) > 3) return jsonResponse({ error: 'invalid date' }, 400);
  // dayPhrase drives what the model is TOLD to call this day, which the
  // caller then reads back on screen (the button/header already say
  // "yesterday" or a specific date), so it has to agree with the caller's
  // own local calendar day, not the server's UTC one. payload.daysAgo
  // (LB.buildDailySummaryPayload, src/store.js) is exactly that: computed
  // client-side from the caller's local "today". Trusted only for phrasing,
  // never for the validity bound above, this only affects text shown back to
  // the same account that sent it, nothing security-relevant rides on it. A
  // caller that omits it (an older client, or a direct API call) falls back
  // to the server's own UTC-based dayDiff, unchanged from before.
  const clientDaysAgo = Number.isInteger(payload?.daysAgo) ? payload.daysAgo : null;
  const dayPhrase = dayPhraseFor(clientDaysAgo != null && clientDaysAgo >= 0 && clientDaysAgo <= 10 ? clientDaysAgo : dayDiff);
  if (payloadIsEmpty(payload)) return jsonResponse({ error: 'Nothing logged that day, nothing to summarize.' }, 400);

  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !serviceKey) return jsonResponse({ error: 'Not set up yet (missing SUPABASE_SERVICE_ROLE_KEY).' }, 503);

  // Pre-read: (a) a fast-path reject for the obvious already-generated case,
  // (b) hands back the row's existing id, if any, so the atomic claim below
  // knows whether to UPDATE an existing row or INSERT a fresh one. This is
  // NOT the authoritative gate by itself: two concurrent requests can both
  // pass it before either claims, see the atomic claim further down for the
  // part that actually has to live server-side and can't be bypassed by
  // calling this endpoint directly.
  let existingId: string | null = null;
  try {
    const r = await fetch(
      `${base}/rest/v1/zane_daily_logs?user_id=eq.${userId}&date=eq.${encodeURIComponent(date)}&select=id,ai_summary_generated_at`,
      { headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey } },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]) {
        existingId = rows[0].id ?? null;
        if (rows[0].ai_summary_generated_at && !isAdmin) {
          return jsonResponse({ error: 'Already generated for that day.' }, 409);
        }
      }
    }
  } catch (e) {
    console.error('[ai-daily-summary] pre-read error:', e);
    return jsonResponse({ error: 'Could not check today\'s summary status. Try again.' }, 502);
  }

  if (!isAdmin && !await withinQuota(userId, 'daily_summary', DAILY_SUMMARY_LIMIT)) {
    return jsonResponse({ error: `That's ${DAILY_SUMMARY_LIMIT} summary attempts today, well past normal use. The limit resets tomorrow.` }, 429);
  }

  // Manual-testing override only, see the file header; the app never sends this.
  const explicitProvider = isProviderId(payload?.provider) ? payload.provider : null;

  // Atomic claim, performed right before the (slow, paid) model call:
  // the pre-read above only rejects the OBVIOUS already-done case, two
  // concurrent requests can both sail through it before either writes, both
  // then paying for a full Anthropic call. This is the real gate. A
  // conditional UPDATE (only when still NULL) if a row already exists,
  // otherwise a plain INSERT that leans on the user_id+date UNIQUE
  // constraint (see the on_conflict=user_id,date upsert further down) to
  // reject a concurrent duplicate. Either way exactly one concurrent caller
  // can win; the loser gets the same 409 as the already-generated case
  // above, without ever calling Anthropic. Admin intentionally skips the
  // claim entirely (and the rollback below): the gate doesn't apply to
  // admin, same as the pre-read's 409 bypass above.
  const claimedAt = new Date().toISOString();
  let rowId: string;
  let claimed = false;
  if (isAdmin) {
    rowId = existingId ?? crypto.randomUUID();
  } else if (existingId) {
    let claimResp: Response;
    try {
      claimResp = await fetch(
        `${base}/rest/v1/zane_daily_logs?id=eq.${existingId}&ai_summary_generated_at=is.null`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': serviceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({ ai_summary_generated_at: claimedAt }),
        },
      );
    } catch (e) {
      console.error('[ai-daily-summary] claim fetch error:', e);
      return jsonResponse({ error: 'Could not check today\'s summary status. Try again.' }, 502);
    }
    if (!claimResp.ok) {
      console.error('[ai-daily-summary] claim error', claimResp.status, await claimResp.text().catch(() => ''));
      return jsonResponse({ error: 'Could not check today\'s summary status. Try again.' }, 502);
    }
    const claimedRows = await claimResp.json().catch(() => []);
    if (!Array.isArray(claimedRows) || !claimedRows.length) {
      // Someone else's request already flipped ai_summary_generated_at
      // between our pre-read and this UPDATE: same outcome as the
      // already-generated case above.
      return jsonResponse({ error: 'Already generated for that day.' }, 409);
    }
    rowId = existingId;
    claimed = true;
  } else {
    rowId = crypto.randomUUID();
    let insertResp: Response;
    try {
      insertResp = await fetch(`${base}/rest/v1/zane_daily_logs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ id: rowId, user_id: userId, date, ai_summary_generated_at: claimedAt }),
      });
    } catch (e) {
      console.error('[ai-daily-summary] claim insert error:', e);
      return jsonResponse({ error: 'Could not check today\'s summary status. Try again.' }, 502);
    }
    if (!insertResp.ok) {
      // A concurrent request won the race and inserted this user_id+date row
      // first (the UNIQUE constraint rejects our duplicate insert): same
      // outcome as the already-generated case above.
      if (insertResp.status === 409) return jsonResponse({ error: 'Already generated for that day.' }, 409);
      console.error('[ai-daily-summary] claim insert error', insertResp.status, await insertResp.text().catch(() => ''));
      return jsonResponse({ error: 'Could not check today\'s summary status. Try again.' }, 502);
    }
    claimed = true;
  }

  const modelCall = {
    system: buildSystemPrompt(dayPhrase),
    userText: buildUserPrompt(payload, dayPhrase),
    maxTokens: 500,
    reasoningBudget: null,
  };
  const result = explicitProvider
    ? await callModel(explicitProvider, modelCall, LABELS)
    : await callModelWithFallback(PRIMARY_PROVIDER, FALLBACK_PROVIDER, modelCall, LABELS);
  if (!result.ok) {
    if (claimed) await releaseClaim(base, serviceKey, rowId);
    return jsonResponse({ error: result.error }, result.status);
  }

  const text = result.text;
  if (!text.trim()) {
    if (claimed) await releaseClaim(base, serviceKey, rowId);
    return jsonResponse({ error: 'Got an empty response. Try again.' }, 422);
  }

  // Store the full text as-is (headline + blank line + body): the client
  // re-splits it the same way (LB.splitHeadlineBody) whether it's this fresh
  // response or a cached summary loaded from zane_daily_logs later, one
  // splitting rule instead of a separate persisted headline column.
  const summary = stripEmDash(text).trim();
  const generatedAt = new Date().toISOString();

  // The row is now guaranteed to already exist, either it already did
  // (existingId) or the claim above just inserted it (rowId): still an
  // upsert (not a plain PATCH) so a first-ever ADMIN regenerate on a
  // still-rowless day also works, since admin's rowId can be a fresh uuid
  // that was never actually inserted anywhere by the claim step it skipped.
  try {
    const r = await fetch(`${base}/rest/v1/zane_daily_logs?on_conflict=user_id,date`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id: rowId, user_id: userId, date,
        ai_summary: summary, ai_summary_generated_at: generatedAt,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[ai-daily-summary] upsert error', r.status, detail);
      if (claimed) await releaseClaim(base, serviceKey, rowId);
      return jsonResponse({ error: 'Generated the summary but could not save it. Try again.' }, 502);
    }
  } catch (e) {
    console.error('[ai-daily-summary] upsert fetch error:', e);
    if (claimed) await releaseClaim(base, serviceKey, rowId);
    return jsonResponse({ error: 'Generated the summary but could not save it. Try again.' }, 502);
  }

  return jsonResponse({ summary, generatedAt }, 200);
});
