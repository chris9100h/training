// Yesterday's AI Health Summary for the Health tab's AiSummaryCard. User-
// triggered only (never a cron/push), once per day per user: the client only
// shows the "Generate" button on a day zane_daily_logs.ai_summary_generated_at
// is still null, and this function re-checks that same gate server-side (a
// client-only gate is trivially bypassed by calling this endpoint directly).
//
// Unlike the label scanner, this is plain text in, plain text out, no vision,
// no strict JSON: a model instructed to "keep it casual" can and does malform
// JSON, so the contract here is a simple two-part text format instead (see
// SYSTEM_PROMPT). All the day's numbers/trends, including the training
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
// through every exercise in turn no matter how firmly SYSTEM_PROMPT told it
// not to. Capping the data itself is what actually holds.
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

import { ADMIN_EMAIL, jsonResponse, preflight, resolveUser, withinQuota } from '../_shared/edge.ts';
import { callModel, callModelWithFallback, isProviderId, stripEmDash } from '../_shared/ai.ts';

const DAILY_SUMMARY_LIMIT = 5;

// Qwen runs first for the cost; Claude was the long-standing default before
// Qwen existed and is what a Qwen failure falls back to, see
// callModelWithFallback in _shared/ai.ts.
const PRIMARY_PROVIDER = 'qwen';
const FALLBACK_PROVIDER = 'claude';

const LABELS = { tag: 'ai-daily-summary', feature: 'AI summaries', subject: 'summary writer' };

const SYSTEM_PROMPT = `You are a knowledgeable, opinionated fitness coach giving yesterday's daily debrief. Your job is to EVALUATE the day, not narrate it back: form a real judgment (a strong day, a mediocre one, something worth flagging) and lead with that, the way an actual coach talking to their athlete would, never a data recap. The user is reading this today about yesterday, so always call it "yesterday", never "today". The numbers and trends you're given, including any training comparison against the user's own history, have already been computed and checked; do not recompute them, and do not walk through them one item at a time, decide what they mean and say that. This can include weight, strength training, cardio, macros, steps, water, and medication doses, whatever was actually logged that day.

If a training session is included, lead with the SESSION AS A WHOLE: overall effort, intensity, load trend, and how it fits the user's recent training, not a rundown of individual lifts. You may be given up to two pre-identified highlight movements (one trending up in volume, one trending down), already computed, not something to recompute or verify. These are optional color, not a checklist: mention AT MOST ONE of them, briefly, across your entire response (not one per paragraph), and only if it genuinely adds something the session-level read didn't already say. If there is no comparison to a previous session, there are no highlights to mention, full stop. A session flagged as a deload week is deliberately lighter by design, read it that way, not as a regression.

The days-since-last-time figure on a training comparison is a plain scheduling fact about that ONE exact session slot, nothing more: this app rotates several different session types (e.g. Push1, Pull1, Legs, Push2, Pull2, each its own slot), so the same slot naturally recurs only every several days, that is completely normal, not a gap in training. When you refer to it, use the exact session name you were given (e.g. "Pull2"), never generalize it to a broader category like "pull sessions" or "leg day": there can be another, differently-named session of a similar type in between (a separate Pull1, for instance), so a generalized label overstates how rarely the user actually trains that way. Never read the gap as time off, a break, reduced training, illness, or "coming back to it", and never phrase it that way. If the user was actually sick, on vacation, or deloading, that would be stated explicitly elsewhere in the data, never infer it from a scheduling gap alone.

You are told the user's current goal, cutting, gaining, or maintaining, or that no goal was specified. Judge the weight trend's direction ONLY against that: for a cut, a decrease is the desired direction and an increase is what's worth flagging; for a gain, the reverse, an increase is desired and a decrease is worth flagging; for maintain, staying flat IS the goal, so it is a material move in EITHER direction that's worth a mention, not a decrease specifically. Never default to treating a falling number as inherently good progress, that reflex is only correct for a subset of users and is actively wrong, even a little insulting, for someone deliberately gaining. If no goal was given, report the weight trend as a plain fact only (the number and its direction), never characterize it as good, bad, on track, or the right or wrong direction, you were not given enough to make that call.

If cardio is logged, it is its own separate activity from any strength session, report it as such (type, duration, distance, effort), it does not need to be folded into the training verdict above. One narrow, explicit exception to "never invent a reason" below: a hard or long cardio session can genuinely cause short-term water-weight swings (sweat loss, glycogen use), that is a real, general training fact, not user-specific speculation. If cardio was logged and the weight trend looks like it could plausibly reflect that, you may mention it as gentle context, phrased as a possibility, never as a certain cause. This exception is specifically about cardio and water weight, nothing else, never extend the same kind of reasoning to nutrition, sleep, stress, or any other guess.

You are NOT a doctor. Never give medical advice, never comment on medication dosage, timing, or interactions, never suggest changing a medication, never diagnose or speculate about a medical condition. If medication doses are mentioned, only note whether they were taken as scheduled, nothing else. Blood glucose, blood pressure, and body temperature readings, when given, are for tracking only: if one is genuinely worth a mention, state the number neutrally, never label it high, low, borderline, or concerning, and never guess at what caused it (diet, a calorie deficit, hydration, training, or anything else). You are not given nearly enough to make that call responsibly, and getting it wrong reads as real medical scaremongering over what is often a completely normal number.

Always land on a genuine, specific verdict, not a generic "good job": what does this day actually tell you about how things are going. Add one concrete, actionable tip only when something EXPLICITLY given directly shows a real problem (adherence well under target, protein or calories clearly missed, a genuine stall or drop in the training comparison, very little water, a skipped dose, and similar), phrased like a coach would say it out loud, not like a lecture. Never manufacture a concern out of a number that is simply present but not actually off. When in doubt, say nothing about it, a clean day gets a real opinion, it does not need a tip attached.

Only comment on trends and numbers you are explicitly given, and take them at face value: never invent a reason, a cause, or a backstory for any of them, including gaps, dips, or single readings. If something wasn't logged, don't guess why, just leave it out.

Style: plain, direct, opinionated but honest, like a coach's voice note, not a text message and not a report. No markdown, no bullet points, no emoji, no walking through every metric in order, and never use an em dash; use a comma or a period instead.

Output EXACTLY two parts and nothing else:
1. A short headline that states your actual verdict on the day, not just a topic label, no more than 8 words, no ending punctuation.
2. A blank line, then the body: 2-3 short paragraphs (1-3 sentences each), each separated by a blank line, never one dense wall of text. Lead with your verdict in the first paragraph, use the next paragraph for the specifics that actually back it up (training, nutrition, whatever mattered), and only add a third if there's a genuine tip or forward-looking note, a light day does not need to be padded out to three.
Do not label the parts (no "Headline:", no "Paragraph 1"), do not add a greeting or sign-off.`;

// First-half-average vs second-half-average, NOT first-vs-last: a single
// noisy weigh-in on either end of the window (water, timing) would otherwise
// swing the whole read. Same smoothing src/store.js's estimateAdaptiveTdee
// already uses for this exact 14-day weight signal (the weekly check-in
// feature), kept consistent rather than quietly inventing a second,
// disagreeing definition of "trend" for the same underlying number. On an
// odd count the single middle entry is dropped from both halves rather than
// assigned to either, same as there.
function fmtWeightTrend(trend: Array<{ date: string; weight: number }>): string {
  if (!Array.isArray(trend) || trend.length < 2) return 'no weight trend available (fewer than 2 points logged recently)';
  const n = trend.length;
  const half = Math.floor(n / 2);
  if (half < 1) return 'no weight trend available (fewer than 2 points logged recently)';
  const avgOf = (list: Array<{ weight: number }>) => list.reduce((s, l) => s + l.weight, 0) / list.length;
  const delta = avgOf(trend.slice(n - half)) - avgOf(trend.slice(0, half));
  const days = n;
  if (Math.abs(delta) < 0.3) return `flat over the last ${days} logged days (first-half vs second-half average)`;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg over the last ${days} logged days (first-half vs second-half average, not a single-day comparison)`;
}

function daysBetween(earlierISO: string, laterISO: string): number {
  const a = new Date(earlierISO + 'T00:00:00Z').getTime();
  const b = new Date(laterISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

// Renders the training array into prose-ready lines. Per-session totals and
// deltas are simple arithmetic (computed here, same "compute the number, let
// Claude phrase it" split as fmtWeightTrend above). Deliberately no
// per-exercise set-by-set listing: LB.dsExerciseHighlights (src/store.js)
// already boiled that down to at most one riser + one faller by volume %
// before this payload was ever built, a full itemized list here just
// invited Claude to walk through every exercise in turn regardless of what
// the prompt said not to do, capping the data itself is what actually holds.
function buildTrainingLines(training: any[], dateISO: string): string[] {
  if (!Array.isArray(training) || !training.length) return [];
  // Capped the same way foodItems/note further down are: any authenticated
  // user can call this endpoint directly with an oversized body, bypassing
  // the UI's naturally-bounded payload (a real day has 0-1 sessions, rarely
  // 2), which would otherwise drive Anthropic cost/latency for free.
  const capped = training.slice(0, 10);
  const lines: string[] = ['', 'Training logged YESTERDAY:'];
  for (const s of capped) {
    const label = s.dayName || 'Freestyle session';
    const bits = [`${s.doneSets ?? '?'} working sets`, `~${s.volumeKg ?? '?'}kg total volume`];
    if (s.durationMinutes != null) bits.push(`${s.durationMinutes} min`);
    if (s.feel) bits.push(`felt ${s.feel}`);
    lines.push(`- ${label}${s.isDeload ? ' (deload week, deliberately lighter)' : ''}: ${bits.join(', ')}`);
    if (s.comparison) {
      const days = daysBetween(s.comparison.date, dateISO);
      const delta = (s.volumeKg != null && s.comparison.volumeKg != null) ? Math.round(s.volumeKg - s.comparison.volumeKg) : null;
      lines.push(`  Last time this same session ("${label}") was done: ${days} day${days === 1 ? '' : 's'} earlier (${s.comparison.date}), ${s.comparison.doneSets ?? '?'} working sets, ~${s.comparison.volumeKg ?? '?'}kg total volume${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta}kg vs yesterday)` : ''}.`);
    } else {
      lines.push(`  No previous "${label}" session on record to compare against.`);
    }
    if (Array.isArray(s.highlights) && s.highlights.length) {
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

function buildCardioLines(cardio: any[]): string[] {
  if (!Array.isArray(cardio) || !cardio.length) return [];
  // Same reasoning as buildTrainingLines' cap above.
  const capped = cardio.slice(0, 10);
  const lines: string[] = ['', 'Cardio logged YESTERDAY:'];
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

function buildUserPrompt(p: Record<string, any>): string {
  const lines: string[] = [`One user's health-tracking data for YESTERDAY (${p.date}):`, ''];
  const weight = num(p.weight);
  if (weight != null) {
    lines.push(`Weight: ${weight} kg logged that day. Trend: ${fmtWeightTrend(p.weightTrend)}`);
    // Directly beneath the trend line, only shown alongside it: the trend is
    // only ever interpreted relative to this, see SYSTEM_PROMPT's explicit
    // instruction never to default to "down is good" or "up is good" on
    // its own.
    const goalText = fmtGoal(p.goal);
    lines.push(goalText ? `User's current goal: ${goalText}.` : `User's current goal: not specified, do not assume one.`);
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
    lines.push(`Logged: ${p.foodItems.slice(0, 12).map((f: any) => f.name).filter(Boolean).join(', ')}`);
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
  if (p.note) lines.push(`User's own note: "${String(p.note).slice(0, 300)}"`);
  lines.push(...buildTrainingLines(p.training, p.date));
  lines.push(...buildCardioLines(p.cardio));
  lines.push('', 'Write the headline + paragraph as instructed.');
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
  // Loose sanity bound, not a strict "must be exactly yesterday" check: exact
  // "yesterday" is inherently client-timezone-dependent, the server can't
  // know the user's local timezone precisely. This is only a backstop
  // against a badly wrong client clock or a future client regression, since
  // the prompt below unconditionally tells the model to treat this date as
  // yesterday (see SYSTEM_PROMPT and buildUserPrompt). An unparseable date
  // makes daysBetween return NaN, which isNaN() below also rejects.
  const todayUTC = new Date().toISOString().slice(0, 10);
  const dayDiff = daysBetween(date, todayUTC);
  if (isNaN(dayDiff) || Math.abs(dayDiff) > 3) return jsonResponse({ error: 'invalid date' }, 400);
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
    system: SYSTEM_PROMPT,
    userText: buildUserPrompt(payload),
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
