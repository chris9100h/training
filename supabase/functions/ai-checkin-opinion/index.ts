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

const SYSTEM_PROMPT = `You are a casual, supportive fitness coach giving a quick read on a client's weekly check-in, exactly the way a real coach reviewing the same form would. You are being given data that has already been computed and checked; do not recompute or second-guess the numbers or trends you're told, just react to them naturally.

You are NOT a doctor. Never give medical advice, never diagnose or speculate about a medical condition, never comment on medication. Stick to training, nutrition, recovery, and how this week compares to recent ones.

Only comment on what you are explicitly given. If something wasn't answered, don't guess why or make up a reason, just leave it out.

Style: short, plain, encouraging but honest, like a coach's quick note back. No markdown, no bullet points, no emoji, no restating every field back mechanically, and never use an em dash; use a comma or a period instead.

Output EXACTLY two parts and nothing else:
1. A short headline, no more than 8 words, no ending punctuation.
2. A blank line, then one paragraph of 2-4 casual sentences with your actual read on the week.
Do not label the parts (no "Headline:"), do not add a greeting or sign-off.`;

function buildUserPrompt(schema: any[], responses: Record<string, unknown>, priorResponses: Record<string, unknown> | null, macros: any | null): string {
  const lines: string[] = ["This week's check-in:", ...buildResponsesLines(schema, responses)];
  if (priorResponses) {
    lines.push('', 'PREVIOUS WEEK (for comparison, do not just restate it, use it to judge trend):', ...buildResponsesLines(schema, priorResponses));
  }
  if (macros) {
    lines.push('', 'CURRENT NUTRITION TARGETS:',
      `  Training day: ${macros.calories_training ?? '?'} kcal, ${macros.protein_training ?? '?'}g protein, ${macros.carbs_training ?? '?'}g carbs, ${macros.fat_training ?? '?'}g fat`,
      `  Rest day: ${macros.calories_rest ?? '?'} kcal, ${macros.protein_rest ?? '?'}g protein, ${macros.carbs_rest ?? '?'}g carbs, ${macros.fat_rest ?? '?'}g fat`);
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

  const priorRows = await callerGet(base, callerToken, anon,
    `zane_checkins?coaching_id=eq.${encodeURIComponent(coachingId)}&id=neq.${encodeURIComponent(checkinId)}&select=responses&order=week_start.desc&limit=1`);
  const priorResponses = priorRows[0]?.responses || null;

  const macroRows = await callerGet(base, callerToken, anon,
    `zane_coaching_macros?coaching_id=eq.${encodeURIComponent(coachingId)}&select=calories_training,protein_training,carbs_training,fat_training,calories_rest,protein_rest,carbs_rest,fat_rest&order=set_at.desc&limit=1`);
  const macros = macroRows[0] || null;

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
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(effectiveSchema, responses, priorResponses, macros) }] }],
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
