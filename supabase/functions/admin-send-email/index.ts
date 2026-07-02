// Lets the admin send a one-off email to a specific user from the Admin
// dashboard (Settings → Admin → All users → user detail → Send email).
// Delivery goes through Resend, the same provider already handling
// Supabase Auth's transactional mail (password reset, email change) for
// this project — RESEND_API_KEY must be set as a Supabase Edge Function
// secret, and RESEND_FROM_EMAIL should match the @zane-wo.com sender
// already verified there (falls back to a default if unset).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const ADMIN_EMAIL = 'office@btc-prime.biz';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolveUserEmail(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.email ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const callerEmail = await resolveUserEmail(req);
  if (callerEmail !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { to, subject, message } = await req.json().catch(() => ({}));
  if (typeof to !== 'string' || !EMAIL_RE.test(to)) {
    return new Response(JSON.stringify({ error: 'invalid recipient' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const subjectTrimmed = typeof subject === 'string' ? subject.trim() : '';
  const messageTrimmed = typeof message === 'string' ? message.trim() : '';
  if (!subjectTrimmed || !messageTrimmed) {
    return new Response(JSON.stringify({ error: 'subject and message required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Zane <office@zane-wo.com>';

  const html = `<p>${escapeHtml(messageTrimmed).replace(/\n/g, '<br>')}</p>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: subjectTrimmed, text: messageTrimmed, html }),
  }).catch(() => null);

  if (!r?.ok) {
    const body = await r?.text().catch(() => '');
    return new Response(JSON.stringify({ error: `Resend error: ${body}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const data = await r.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: true, id: data?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
