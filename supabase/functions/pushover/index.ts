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

  const send = async () => {
    if (delaySeconds > 0) {
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
    }
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user, message, title }),
    }).catch(() => {});
  };

  // Respond immediately so the client connection closes.
  // waitUntil keeps the function alive in the background until send() resolves.
  EdgeRuntime.waitUntil(send());

  return new Response(JSON.stringify({ scheduled: true, delaySeconds }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
