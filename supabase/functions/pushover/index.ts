const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const token = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
  const user  = Deno.env.get('PUSHOVER_USER')  ?? 'uxrg8gh43b1tpw31pq4r4i4ebqrhjt';

  const { message = 'Pause vorbei — weiter gehts! 💪', title = 'Logbook', delaySeconds = 0 } = await req.json().catch(() => ({}));

  if (delaySeconds > 0) {
    await new Promise(r => setTimeout(r, Math.max(0, delaySeconds - 5) * 1000));
  }

  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user, message, title }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
