// Yesterday's AI Health Summary for the Health tab's AiSummaryCard. User-
// triggered only (never a cron/push), once per day per user: the client only
// shows the "Generate" button on a day zane_daily_logs.ai_summary_generated_at
// is still null, and this function re-checks that same gate server-side (a
// client-only gate is trivially bypassed by calling this endpoint directly).
//
// Unlike scan-label-claude, this is plain text in, plain text out, no vision,
// no strict JSON: a model instructed to "keep it casual" can and does malform
// JSON, so the contract here is a simple two-part text format instead (see
// SYSTEM_PROMPT). All the day's numbers/trends are assembled CLIENT-SIDE
// (LB.buildDailySummaryPayload, already-loaded store data, no extra fetch)
// and handed to Claude pre-computed: Claude phrases them, it does not
// recompute or eyeball a trend itself, so a wrong read of "trending down" vs
// "trending up" is not a failure mode this function has to worry about.
//
// One action: POST { date, weight, weightTrend, steps, calories, protein,
// carbs, fat, targets, adherence, waterMl, foodItems, medsDue, medsTaken,
// medsTakenNames, glucose, bloodPressure, bodyTemp, note }
// (exact shape: LB.buildDailySummaryPayload in src/store.js)
// -> { headline: string|null, body: string, generatedAt: string }
//
// Needs the secret ANTHROPIC_API_KEY (same one scan-label-claude uses), and
// SUPABASE_SERVICE_ROLE_KEY (for the pre-read/write against zane_daily_logs,
// which bypasses RLS: see the comment above upsertSummary for why that's
// needed here specifically, not just convenient).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const DAILY_SUMMARY_LIMIT = 5;

// Advisory per-user daily quota (same zane_api_usage/bump_api_usage as
// scan-label-claude, migration 0207, new kind 'daily_summary'). Fails OPEN on
// purpose, same reasoning as there: a broken quota mechanism must never be
// the reason someone can't get their summary. The REAL once-a-day gate is
// ai_summary_generated_at below; this is only a backstop against a retry
// storm or multi-tab spam before a first successful generation.
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

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
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

const SYSTEM_PROMPT = `You are a casual, supportive fitness coach texting a quick read on ONE day of a user's tracked health data (weight, macros, steps, water, medication doses). You are being given data that has already been computed and checked; do not recompute or second-guess the numbers or trends you're told, just react to them naturally, the way a coach glancing at an app would.

You are NOT a doctor. Never give medical advice, never comment on medication dosage, timing, or interactions, never suggest changing a medication, never diagnose or speculate about a medical condition. If medication doses are mentioned, only note whether they were taken as scheduled, nothing else.

Only comment on trends and numbers you are explicitly given. If something wasn't logged, don't guess why or make up a reason, just leave it out.

Style: short, plain, encouraging but honest, like a text message. No markdown, no bullet points, no emoji, no restating every number back mechanically, and never use an em dash; use a comma or a period instead.

Output EXACTLY two parts and nothing else:
1. A short headline, no more than 8 words, no ending punctuation.
2. A blank line, then one paragraph of 2-4 casual sentences with your actual read on the day.
Do not label the parts (no "Headline:"), do not add a greeting or sign-off.`;

function fmtWeightTrend(trend: Array<{ date: string; weight: number }>): string {
  if (!Array.isArray(trend) || trend.length < 2) return 'no weight trend available (fewer than 2 points logged recently)';
  const first = trend[0].weight;
  const last = trend[trend.length - 1].weight;
  const delta = last - first;
  const days = trend.length;
  if (Math.abs(delta) < 0.3) return `flat over the last ${days} logged days`;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg over the last ${days} logged days`;
}

function buildUserPrompt(p: Record<string, any>): string {
  const lines: string[] = [`One user's health-tracking data for ${p.date}:`, ''];
  if (p.weight != null) {
    lines.push(`Weight: ${p.weight} kg logged that day. Trend: ${fmtWeightTrend(p.weightTrend)}`);
  } else {
    lines.push('Weight: not logged that day.');
  }
  if (p.targets?.dayType) lines.push(`Day type: ${p.targets.dayType}`);
  if (p.calories != null || p.protein != null || p.carbs != null || p.fat != null) {
    lines.push(`Nutrition: ${p.calories ?? '?'} kcal, ${p.protein ?? '?'}g protein, ${p.carbs ?? '?'}g carbs, ${p.fat ?? '?'}g fat`);
  }
  if (p.targets) {
    lines.push(`Targets: ${p.targets.calories ?? '?'} kcal, ${p.targets.protein ?? '?'}g protein, ${p.targets.carbs ?? '?'}g carbs, ${p.targets.fat ?? '?'}g fat`);
  }
  if (p.adherence != null) lines.push(`Macro adherence: ${Math.round(p.adherence)}%`);
  if (p.steps != null) lines.push(`Steps: ${p.steps}`);
  if (p.waterMl != null) lines.push(`Water: ${p.waterMl} ml`);
  if (Array.isArray(p.foodItems) && p.foodItems.length) {
    lines.push(`Logged: ${p.foodItems.slice(0, 12).map((f: any) => f.name).filter(Boolean).join(', ')}`);
  }
  if (p.medsDue > 0) lines.push(`Medications: ${p.medsTaken} of ${p.medsDue} scheduled doses taken`);
  if (Array.isArray(p.glucose) && p.glucose.length) {
    lines.push(`Blood glucose readings: ${p.glucose.map((g: any) => `${g.valueMmol} mmol/L${g.context ? ` (${g.context})` : ''}`).join(', ')}`);
  }
  if (Array.isArray(p.bloodPressure) && p.bloodPressure.length) {
    lines.push(`Blood pressure: ${p.bloodPressure.map((b: any) => `${b.systolic}/${b.diastolic}`).join(', ')}`);
  }
  if (Array.isArray(p.bodyTemp) && p.bodyTemp.length) {
    lines.push(`Body temperature: ${p.bodyTemp.map((t: any) => `${t.valueC}°C`).join(', ')}`);
  }
  if (p.note) lines.push(`User's own note: "${String(p.note).slice(0, 300)}"`);
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
    && !(Array.isArray(p.bodyTemp) && p.bodyTemp.length);
}

// CLAUDE.md's house rule ("no em dashes, ever") is enforced on committed
// source by tools/check-emdash.cjs, which can't touch runtime LLM output. A
// prompt instruction alone is not a guarantee with any LLM, so replace any
// that slip through as a deterministic backstop. Matches by Unicode escape
// (U+2014), not the literal character, so check-emdash.cjs's grep (whose
// only exception is a lone placeholder glyph, not one inside a regex) has
// nothing to flag in this file.
function stripEmDash(s: string): string {
  return s.replace(/\u2014/g, ', ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const userId = await resolveUser(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const payload = await req.json().catch(() => ({}));
  const date = typeof payload?.date === 'string' ? payload.date : '';
  if (!date) return json({ error: 'missing date' }, 400);
  if (payloadIsEmpty(payload)) return json({ error: 'Nothing logged that day, nothing to summarize.' }, 400);

  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !serviceKey) return json({ error: 'Not set up yet (missing SUPABASE_SERVICE_ROLE_KEY).' }, 503);

  // Pre-read: (a) the authoritative once-a-day gate has to live server-side,
  // a client-only check is trivially bypassed by calling this endpoint
  // directly, (b) hands back the row's existing id so the write below
  // doesn't invent a fresh one for a row that already exists, which would
  // otherwise risk losing a concurrent unsynced edit to some OTHER field on
  // the same day the next time the client's cache-first merge runs.
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
        if (rows[0].ai_summary_generated_at) {
          return json({ error: 'Already generated for that day.' }, 409);
        }
      }
    }
  } catch (e) {
    console.error('[ai-daily-summary] pre-read error:', e);
    return json({ error: 'Could not check today\'s summary status. Try again.' }, 502);
  }

  if (!await withinQuota(userId, 'daily_summary', DAILY_SUMMARY_LIMIT)) {
    return json({ error: `That's ${DAILY_SUMMARY_LIMIT} summary attempts today, well past normal use. The limit resets tomorrow.` }, 429);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'AI summaries are not set up yet (missing ANTHROPIC_API_KEY).' }, 503);
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
        messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(payload) }] }],
      }),
    });
  } catch (e) {
    console.error('[ai-daily-summary] anthropic fetch error:', e);
    return json({ error: 'Could not reach the summary writer. Try again.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[ai-daily-summary] anthropic error', resp.status, detail);
    return json({ error: `Summary writer failed (${resp.status}). Try again.` }, 502);
  }

  const data = await resp.json().catch(() => null);
  const content = data?.content;
  const text = Array.isArray(content)
    ? content.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
    : '';
  if (!text.trim()) return json({ error: 'Got an empty response. Try again.' }, 422);

  // Store the full text as-is (headline + blank line + body): the client
  // re-splits it the same way (LB.splitHeadlineBody) whether it's this fresh
  // response or a cached summary loaded from zane_daily_logs later, one
  // splitting rule instead of a separate persisted headline column.
  const summary = stripEmDash(text).trim();
  const generatedAt = new Date().toISOString();

  try {
    const id = existingId ?? crypto.randomUUID();
    const r = await fetch(`${base}/rest/v1/zane_daily_logs?on_conflict=user_id,date`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id, user_id: userId, date,
        ai_summary: summary, ai_summary_generated_at: generatedAt,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[ai-daily-summary] upsert error', r.status, detail);
      return json({ error: 'Generated the summary but could not save it. Try again.' }, 502);
    }
  } catch (e) {
    console.error('[ai-daily-summary] upsert fetch error:', e);
    return json({ error: 'Generated the summary but could not save it. Try again.' }, 502);
  }

  return json({ summary, generatedAt }, 200);
});
