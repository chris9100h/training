// AI Coach opinion on a weekly check-in (CheckInCard, screens-coaching-tabs.jsx).
// Same idea as ai-daily-summary, applied to a zane_checkins row instead of a
// zane_daily_logs row: user-triggered (button on the check-in card, never
// automatic), once per check-in, visible to BOTH the client and their coach
// identically, since CheckInCard is the one shared render both sides already
// use unmodified.
//
// Authorization is delegated to the EXISTING RLS policies (checkins_client /
// checkins_coach_read) rather than reimplemented here: every read in this
// function is done with the CALLER'S OWN bearer token, not the service-role
// key, so a row simply doesn't come back for someone RLS wouldn't already
// let read it. Only the final write needs the service-role key, since a
// coach only has READ access to zane_checkins under checkins_coach_read.
//
// Besides the check-in itself, also pulls a few weeks of prior check-ins
// (trend) and the last two zane_coaching_macros rows (current target + how
// long it's been in place, plus what it was before): a real coach would use
// exactly that context to judge whether the current macro target still fits,
// not just the current week in isolation. There is no structured cut/bulk/
// maintain field anywhere in the data model (checked directly), so intent is
// read the same way a coach reading this same form would: from the trend
// itself and the client's own free-text goal notes, never assumed.
//
// One action: POST { checkinId } -> { opinion: string, generatedAt: string }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const CHECKIN_OPINION_LIMIT = 5;
const ALLOWED_PHASES = new Set(['cut', 'maintain', 'bulk']);

// Same admin identity as admin-send-email/screens-settings.jsx/screens-featuremap.jsx
// (isAdmin = store.user?.email === this). The admin gets unlimited quota AND can
// re-generate past the once-per-check-in gate below, so testing a prompt change
// never needs a manual DB reset.
const ADMIN_EMAIL = 'office@btc-prime.biz';

// Same shape/reasoning as ai-daily-summary's withinQuota: advisory, fails
// OPEN, only a backstop against a retry storm, not the real once-per-check-in
// gate (that's ai_opinion_generated_at, checked further down).
async function withinQuota(userId: string, kind: string, limit: number): Promise<boolean> {
  try {
    const base = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!base || !key) return true;
    const r = await fetch(`${base}/rest/v1/rpc/bump_api_usage`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit }),
    });
    if (!r.ok) return true;
    return (await r.json()) !== false;
  } catch (_) {
    return true;
  }
}

async function resolveUser(token: string): Promise<{ id: string; email: string | null } | null> {
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ? { id: user.id, email: user.email ?? null } : null;
}

// A PostgREST GET using the CALLER'S OWN token: RLS decides what comes back,
// same as if the client had queried directly. An empty array is the correct,
// expected shape for "not authorized" (RLS-filtered), not an error.
async function callerGet(base: string, callerToken: string, anon: string, path: string): Promise<any[]> {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${callerToken}`, 'apikey': anon },
  });
  if (!r.ok) return [];
  return await r.json().catch(() => []);
}

const CHECKIN_DEFAULT_SCHEMA_FALLBACK_NOTE = 'the app\'s default check-in form';

// Simplified field-value resolution for the PROMPT (not the pixel-precise
// UI formatting CheckInCard itself does): enough for Claude to read the
// number/choice sensibly, exact unit conversion isn't load-bearing for a
// casual read the way it is for the actual displayed UI.
// A generated opinion once called a sleep score dropping to 3 a bad sign, but
// sleep_quality is direction:'lower_better' (1 = good, 10 = bad), so a drop is
// an improvement. The label alone can't carry that, so every field with a
// stated direction gets it spelled out inline, the model is never left to
// guess whether a rising or falling number is the good outcome.
function resolveFieldLine(field: any, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (field.type === 'choice' && Array.isArray(field.options)) {
    const opt = field.options.find((o: any) => String(o.value) === String(value));
    return `${field.label}: ${opt ? opt.label : value}`;
  }
  const unit = field.unit && typeof field.unit === 'string' && !['weight'].includes(field.unit) ? ` ${field.unit}` : '';
  const dir = field.direction === 'lower_better' ? ' (lower is better)' : field.direction === 'higher_better' ? ' (higher is better)' : '';
  return `${field.label}: ${value}${unit}${dir}`;
}

function buildResponsesLines(schema: any[], responses: Record<string, unknown>): string[] {
  const lines: string[] = [];
  (schema || []).forEach((section: any) => {
    const secLines: string[] = [];
    (section.fields || []).forEach((field: any) => {
      const line = resolveFieldLine(field, responses?.[field.key]);
      if (line) secLines.push(`  ${line}`);
    });
    // sectionHint (e.g. "1 = good/low, 10 = bad/high") is the same context
    // CheckInCard's own header already shows the human reading this form; the
    // model gets it too, not just the per-field annotation above.
    if (secLines.length) {
      const head = String(section.label || '').toUpperCase() + (section.sectionHint ? ` (${section.sectionHint})` : '');
      lines.push('', head, ...secLines);
    }
  });
  return lines;
}

// Condensed per-week digest for weeks beyond the immediate previous one: full
// field-by-field detail (buildResponsesLines) for several more weeks would
// bloat the prompt for no benefit, only weight/adherence/off-plan matter for
// judging a macro-target trend. Reads these by their known default-schema
// keys directly, same as CheckInCard's own delta math already does regardless
// of a coach's custom schema (a renamed/removed field just yields no line).
function trendDigestLine(weekStart: string, r: Record<string, unknown>): string {
  const parts: string[] = [];
  const w = r?.weight_avg_last_week ?? r?.weight_today;
  if (w != null && w !== '') parts.push(`weight ~${w}`);
  if (r?.macro_adherence != null && r.macro_adherence !== '') parts.push(`adherence ${r.macro_adherence}%`);
  if (r?.off_plan_days != null && r.off_plan_days !== '') parts.push(`${r.off_plan_days} off-plan day${r.off_plan_days === 1 ? '' : 's'}`);
  return parts.length ? `  ${weekStart}: ${parts.join(', ')}` : `  ${weekStart}: nothing relevant logged`;
}

function daysSince(dateStr: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

// A generated opinion once claimed "up about two pounds" when the app's own
// week-over-week card showed a 0.6 down: asking the model to subtract two raw
// numbers itself is exactly the "recompute a number" failure the system
// prompt otherwise tells it not to do. Same weekly-average preference as
// trendDigestLine (never the single noisy day), computed here so the
// arithmetic is always right and the model only has to restate it.
function pickWeeklyWeight(r: Record<string, unknown> | null | undefined): number | null {
  const v = r?.weight_avg_last_week ?? r?.weight_today;
  const n = v != null && v !== '' ? Number(v) : NaN;
  return isNaN(n) ? null : n;
}

function fmtWeightDelta(delta: number): string {
  if (Math.abs(delta) < 0.3) return 'flat';
  return `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)}`;
}

function fmtWeightSeriesTrend(weights: number[]): string {
  if (weights.length < 2) return 'not enough weeks logged yet for a trend read';
  const delta = weights[weights.length - 1] - weights[0];
  return Math.abs(delta) < 0.3
    ? `flat over the last ${weights.length} logged weeks`
    : `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} over the last ${weights.length} logged weeks`;
}

const SYSTEM_PROMPT = `You are a casual, supportive fitness coach giving a quick read on a client's weekly check-in, exactly the way a real coach reviewing the same form would. You are being given data that has already been computed and checked; do not recompute or second-guess the numbers or trends you're told, just react to them naturally. When judging weight trend or direction, always weigh the week's average figure over a single day's number: day-to-day weight moves for reasons that have nothing to do with fat loss or gain, like water, sodium, or meal timing, only the average across days is a meaningful signal. A single day's number is only worth mentioning as color, never as the basis for a trend or a macro comment. Any weight trend or delta you are given (up, down, or flat, by how much) has already been computed correctly from the underlying numbers, just restate it, never subtract or re-derive it yourself. Weight numbers are given exactly as the client logs them, in whichever unit they use; you are not told which, so never state a specific unit for weight (no kg, no lbs, no pounds), just the number and the direction.

Some fields are explicitly marked (lower is better) or (higher is better), for example sleep or stress scored 1 to 10 where a LOWER number is the good outcome. Always read that marker before deciding whether a change is good or bad news, never assume a rising number is automatically an improvement or a falling number is automatically a decline, that assumption is wrong exactly as often as it's right.

You are NOT a doctor. Never give medical advice, never diagnose or speculate about a medical condition, never comment on medication. Stick to training, nutrition, recovery, and how this week compares to recent ones.

You may be told the client's stated phase directly: cut, maintain, or bulk. When given, treat it as ground truth, it is authoritative, never contradict, second-guess, or hedge against it. A cut wants weight trending down (or held at a controlled, intentional pace), a bulk wants it trending up, a maintain wants it roughly flat; a trend that clearly runs the opposite way despite solid adherence is worth a comment. You are also given the client's current nutrition targets, how long they have been in place, and, when there is enough history, a few weeks of weight/adherence trend. Like a real coach, form an opinion on whether those targets still fit the stated (or, if none was given, clearly implied) phase. If the trend and adherence clearly point one way, suggest ONE small, realistic adjustment, a modest calorie change, through carbs or fat rather than protein, and frame it as worth confirming with their coach, not as an instruction to just change it. If adherence has been inconsistent, say that comes first, before touching any numbers. If no phase was stated or implied anywhere, or there is too little trend data yet, or the signal is mixed, say the targets look reasonable for now instead of guessing a direction. Never invent a phase or goal the client hasn't stated or clearly implied.

Only comment on what you are explicitly given. If something wasn't answered, don't guess why or make up a reason, just leave it out.

Style: short, plain, encouraging but honest, like a coach's quick note back. No markdown, no bullet points, no emoji, no restating every field back mechanically, and never use an em dash; use a comma or a period instead.

Output EXACTLY two parts and nothing else:
1. A short headline, no more than 8 words, no ending punctuation.
2. A blank line, then the body: 2-3 short paragraphs (1-3 sentences each), each separated by a blank line, never one dense wall of text. Lead with your actual read on the week in the first paragraph, use the next paragraph for the macro-fit comment when you have one or whatever else actually matters, a light week does not need to be padded out to three.
Do not label the parts (no "Headline:", no "Paragraph 1"), do not add a greeting or sign-off.`;

function buildUserPrompt(
  schema: any[],
  responses: Record<string, unknown>,
  priorResponses: Record<string, unknown> | null,
  earlierWeeks: Array<{ week_start: string; responses: Record<string, unknown> }>,
  macros: any | null,
  priorMacros: any | null,
  phase: string | null,
): string {
  const lines: string[] = [];
  // Told directly by the client at click-time, not inferred: leads the prompt
  // so it's read as the authoritative frame before any of the raw numbers,
  // not a detail buried after them.
  if (phase) {
    lines.push(`STATED GOAL: ${phase} (told directly by the client just now, treat as ground truth).`, '');
  }
  lines.push("This week's check-in:", ...buildResponsesLines(schema, responses));
  if (priorResponses) {
    lines.push('', 'PREVIOUS WEEK (for comparison, do not just restate it, use it to judge trend):', ...buildResponsesLines(schema, priorResponses));
  }
  if (earlierWeeks.length) {
    lines.push('', 'EARLIER WEEKS (oldest to newest, trend only, for judging whether the current macro target is working):',
      ...earlierWeeks.map(w => trendDigestLine(w.week_start, w.responses || {})));
  }
  const thisWeekWeight = pickWeeklyWeight(responses);
  const lastWeekWeight = pickWeeklyWeight(priorResponses);
  const weightSeries = [...earlierWeeks.map(w => pickWeeklyWeight(w.responses)), lastWeekWeight, thisWeekWeight]
    .filter((w): w is number => w != null);
  const trendLines: string[] = [];
  if (thisWeekWeight != null && lastWeekWeight != null) {
    trendLines.push(`  Week-over-week: ${fmtWeightDelta(thisWeekWeight - lastWeekWeight)} from last week (this week ${thisWeekWeight}, last week ${lastWeekWeight}).`);
  }
  if (weightSeries.length >= 2) {
    trendLines.push(`  Overall: ${fmtWeightSeriesTrend(weightSeries)}.`);
  }
  if (trendLines.length) {
    lines.push('', 'PRECOMPUTED WEIGHT TREND (already correct, restate it, never recompute or re-derive it yourself):', ...trendLines);
  }
  if (macros) {
    const age = macros.set_at ? ` (in place for ${daysSince(macros.set_at)} days)` : '';
    lines.push('', `CURRENT NUTRITION TARGETS${age}:`,
      `  Training day: ${macros.calories_training ?? '?'} kcal, ${macros.protein_training ?? '?'}g protein, ${macros.carbs_training ?? '?'}g carbs, ${macros.fat_training ?? '?'}g fat`,
      `  Rest day: ${macros.calories_rest ?? '?'} kcal, ${macros.protein_rest ?? '?'}g protein, ${macros.carbs_rest ?? '?'}g carbs, ${macros.fat_rest ?? '?'}g fat`);
    if (priorMacros) {
      lines.push(`  Previous targets before that: training ${priorMacros.calories_training ?? '?'} kcal, rest ${priorMacros.calories_rest ?? '?'} kcal`);
    }
  }
  lines.push('', 'Write the headline + paragraph as instructed.');
  return lines.join('\n');
}

function stripEmDash(s: string): string {
  return s.replace(/\u2014/g, ', ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const callerToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const caller = await resolveUser(callerToken);
  if (!caller) return json({ error: 'unauthorized' }, 401);
  const userId = caller.id;
  const isAdmin = caller.email === ADMIN_EMAIL;

  const payload = await req.json().catch(() => ({}));
  const checkinId = typeof payload?.checkinId === 'string' ? payload.checkinId : '';
  if (!checkinId) return json({ error: 'missing checkinId' }, 400);
  const rawPhase = typeof payload?.phase === 'string' ? payload.phase.toLowerCase().trim() : '';
  const phase = ALLOWED_PHASES.has(rawPhase) ? rawPhase : null;

  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !serviceKey) return json({ error: 'Not set up yet (missing SUPABASE_SERVICE_ROLE_KEY).' }, 503);

  // Read WITH THE CALLER'S OWN TOKEN: existing RLS (checkins_client /
  // checkins_coach_read) decides whether this comes back at all, no
  // authorization logic duplicated here. An empty result means either the
  // check-in doesn't exist or the caller isn't the client or coach on it.
  const checkinRows = await callerGet(base, callerToken, anon,
    `zane_checkins?id=eq.${encodeURIComponent(checkinId)}&select=id,coaching_id,responses,ai_opinion_generated_at`);
  const checkin = checkinRows[0];
  if (!checkin) return json({ error: 'Check-in not found, or you are not authorized to view it.' }, 403);
  if (checkin.ai_opinion_generated_at && !isAdmin) return json({ error: 'Already generated for that check-in.' }, 409);

  const responses = checkin.responses || {};
  const coachingId = checkin.coaching_id;

  const coachingRows = await callerGet(base, callerToken, anon,
    `zane_coaching?id=eq.${encodeURIComponent(coachingId)}&select=checkin_schema`);
  const schema = coachingRows[0]?.checkin_schema || null;
  if (!schema) {
    // null means "use CHECKIN_DEFAULT_SCHEMA" client-side; this function has
    // no access to that JS constant, so without an explicit schema it can
    // only label fields by their raw snake_case key. Still usable, just
    // less polished, so this is a soft-degrade, not a hard failure.
    console.warn(`[ai-checkin-opinion] no checkin_schema on coaching ${coachingId}, falling back to raw keys (${CHECKIN_DEFAULT_SCHEMA_FALLBACK_NOTE})`);
  }
  const effectiveSchema = schema || Object.keys(responses).map(k => ({ label: '', fields: [{ key: k, label: k, type: 'text' }] }));

  // Immediate previous week stays full-detail (priorResponses, unchanged); up
  // to 3 more before that are fetched too, for the condensed trend digest a
  // macro-fit judgment needs (see trendDigestLine).
  const historyRows = await callerGet(base, callerToken, anon,
    `zane_checkins?coaching_id=eq.${encodeURIComponent(coachingId)}&id=neq.${encodeURIComponent(checkinId)}&select=week_start,responses&order=week_start.desc&limit=4`);
  const priorResponses = historyRows[0]?.responses || null;
  const earlierWeeks = historyRows.slice(1).reverse();

  // Last two targets, not just the latest: lets the prompt say how long the
  // current one has been in place and what it changed from.
  const macroRows = await callerGet(base, callerToken, anon,
    `zane_coaching_macros?coaching_id=eq.${encodeURIComponent(coachingId)}&select=calories_training,protein_training,carbs_training,fat_training,calories_rest,protein_rest,carbs_rest,fat_rest,set_at&order=set_at.desc&limit=2`);
  const macros = macroRows[0] || null;
  const priorMacros = macroRows[1] || null;

  if (!isAdmin && !await withinQuota(userId, 'checkin_opinion', CHECKIN_OPINION_LIMIT)) {
    return json({ error: `That's ${CHECKIN_OPINION_LIMIT} check-in opinions today, well past normal use. The limit resets tomorrow.` }, 429);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'AI opinions are not set up yet (missing ANTHROPIC_API_KEY).' }, 503);
  const model = (Deno.env.get('ANTHROPIC_MODEL') ?? '').trim() || DEFAULT_MODEL;

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 350,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(effectiveSchema, responses, priorResponses, earlierWeeks, macros, priorMacros, phase) }] }],
      }),
    });
  } catch (e) {
    console.error('[ai-checkin-opinion] anthropic fetch error:', e);
    return json({ error: 'Could not reach the opinion writer. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[ai-checkin-opinion] anthropic error', resp.status, detail);
    return json({ error: `Opinion writer failed (${resp.status}). Try again.` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const content = data?.content;
  const text = Array.isArray(content)
    ? content.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
    : '';
  if (!text.trim()) return json({ error: 'Got an empty response. Try again.' }, 422);

  const opinion = stripEmDash(text).trim();
  const generatedAt = new Date().toISOString();

  // The row is guaranteed to already exist (we just read it above), so this
  // is a plain UPDATE, not an upsert: no id to invent, unlike ai-daily-summary
  // where the target zane_daily_logs row might not exist yet.
  try {
    const r = await fetch(`${base}/rest/v1/zane_checkins?id=eq.${encodeURIComponent(checkinId)}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ ai_opinion: opinion, ai_opinion_generated_at: generatedAt }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[ai-checkin-opinion] update error', r.status, detail);
      return json({ error: 'Generated the opinion but could not save it. Try again.' }, 502);
    }
  } catch (e) {
    console.error('[ai-checkin-opinion] update fetch error:', e);
    return json({ error: 'Generated the opinion but could not save it. Try again.' }, 502);
  }

  return json({ opinion, generatedAt }, 200);
});
