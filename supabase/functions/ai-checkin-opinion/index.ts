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

async function resolveUser(token: string): Promise<string | null> {
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ?? null;
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
function resolveFieldLine(field: any, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (field.type === 'choice' && Array.isArray(field.options)) {
    const opt = field.options.find((o: any) => String(o.value) === String(value));
    return `${field.label}: ${opt ? opt.label : value}`;
  }
  const unit = field.unit && typeof field.unit === 'string' && !['weight'].includes(field.unit) ? ` ${field.unit}` : '';
  return `${field.label}: ${value}${unit}`;
}

function buildResponsesLines(schema: any[], responses: Record<string, unknown>): string[] {
  const lines: string[] = [];
  (schema || []).forEach((section: any) => {
    const secLines: string[] = [];
    (section.fields || []).forEach((field: any) => {
      const line = resolveFieldLine(field, responses?.[field.key]);
      if (line) secLines.push(`  ${line}`);
    });
    if (secLines.length) lines.push('', String(section.label || '').toUpperCase(), ...secLines);
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

const SYSTEM_PROMPT = `You are a casual, supportive fitness coach giving a quick read on a client's weekly check-in, exactly the way a real coach reviewing the same form would. You are being given data that has already been computed and checked; do not recompute or second-guess the numbers or trends you're told, just react to them naturally.

You are NOT a doctor. Never give medical advice, never diagnose or speculate about a medical condition, never comment on medication. Stick to training, nutrition, recovery, and how this week compares to recent ones.

You are also given the client's current nutrition targets, how long they have been in place, and, when there is enough history, a few weeks of weight/adherence trend. Like a real coach, form an opinion on whether those targets still fit. If the trend and adherence clearly point one way (weight stalled or moving the wrong way despite solid adherence, or clearly overshooting whatever goal the client has actually stated), suggest ONE small, realistic adjustment, a modest calorie change, through carbs or fat rather than protein, and frame it as worth confirming with their coach, not as an instruction to just change it. If adherence has been inconsistent, say that comes first, before touching any numbers. If there is too little trend data yet, or the signal is mixed, or no goal is stated or implied anywhere, say the targets look reasonable for now instead of guessing a direction. Never invent a goal the client hasn't stated or clearly implied.

Only comment on what you are explicitly given. If something wasn't answered, don't guess why or make up a reason, just leave it out.

Style: short, plain, encouraging but honest, like a coach's quick note back. No markdown, no bullet points, no emoji, no restating every field back mechanically, and never use an em dash; use a comma or a period instead.

Output EXACTLY two parts and nothing else:
1. A short headline, no more than 8 words, no ending punctuation.
2. A blank line, then one paragraph of 3-5 casual sentences with your actual read on the week, including the macro-fit comment when you have one.
Do not label the parts (no "Headline:"), do not add a greeting or sign-off.`;

function buildUserPrompt(
  schema: any[],
  responses: Record<string, unknown>,
  priorResponses: Record<string, unknown> | null,
  earlierWeeks: Array<{ week_start: string; responses: Record<string, unknown> }>,
  macros: any | null,
  priorMacros: any | null,
): string {
  const lines: string[] = ["This week's check-in:", ...buildResponsesLines(schema, responses)];
  if (priorResponses) {
    lines.push('', 'PREVIOUS WEEK (for comparison, do not just restate it, use it to judge trend):', ...buildResponsesLines(schema, priorResponses));
  }
  if (earlierWeeks.length) {
    lines.push('', 'EARLIER WEEKS (oldest to newest, trend only, for judging whether the current macro target is working):',
      ...earlierWeeks.map(w => trendDigestLine(w.week_start, w.responses || {})));
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
  const userId = await resolveUser(callerToken);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const payload = await req.json().catch(() => ({}));
  const checkinId = typeof payload?.checkinId === 'string' ? payload.checkinId : '';
  if (!checkinId) return json({ error: 'missing checkinId' }, 400);

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
  if (checkin.ai_opinion_generated_at) return json({ error: 'Already generated for that check-in.' }, 409);

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

  if (!await withinQuota(userId, 'checkin_opinion', CHECKIN_OPINION_LIMIT)) {
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
        messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(effectiveSchema, responses, priorResponses, earlierWeeks, macros, priorMacros) }] }],
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
