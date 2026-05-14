const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SELF_URL  = 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const MAX_CHUNK = 25; // seconds per hop — well within Supabase's wall-clock limit

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const token = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
  const user  = Deno.env.get('PUSHOVER_USER')  ?? 'uxrg8gh43b1tpw31pq4r4i4ebqrhjt';

  const { message = 'Pause vorbei — weiter gehts! 💪', title = 'Logbook', delaySeconds = 0 } = await req.json().catch(() => ({}));

  const run = async () => {
    console.log(`[pushover] delaySeconds=${delaySeconds}`);
    if (delaySeconds > MAX_CHUNK) {
      // Sleep one chunk, then relay to self with the remaining delay
      await new Promise(r => setTimeout(r, MAX_CHUNK * 1000));
      await fetch(SELF_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, title, delaySeconds: delaySeconds - MAX_CHUNK }),
      }).catch(e => console.error('[pushover] relay error:', e));
    } else {
      if (delaySeconds > 0) await new Promise(r => setTimeout(r, delaySeconds * 1000));
      console.log('[pushover] sending');
      const r = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, user, message, title }),
      });
      console.log(`[pushover] ${r.status}: ${await r.text()}`);
    }
  };

  EdgeRuntime.waitUntil(run());

  return new Response(JSON.stringify({ scheduled: true, delaySeconds }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
