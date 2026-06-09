const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

async function sendPushover(userKey: string, userId: string, message: string) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return fetch(`${base}/functions/v1/pushover`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, title: 'Zane', userKey, userId }),
  }).catch(e => console.error('[auto-close] pushover error:', e));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const run = async () => {
    const now = new Date();

    // All open sessions including day_name and date for the notification
    const sessRes = await dbFetch('zane_sessions?ended=is.null&select=id,user_id,started_at,day_name,date');
    const sessions: { id: string; user_id: string; started_at: string; day_name: string; date: string }[] = await sessRes.json().catch(() => []);

    let closed = 0, deleted = 0;

    for (const sess of sessions) {
      // User settings
      const settRes = await dbFetch(
        `zane_user_settings?user_id=eq.${sess.user_id}&select=session_timeout_minutes,push_enabled,pushover_user_key,in_progress_session_id`
      );
      const [sett] = await settRes.json().catch(() => [null]);
      const timeoutMin: number = sett?.session_timeout_minutes ?? 90;

      // Last set activity
      const setsRes = await dbFetch(
        `zane_sets?session_id=eq.${sess.id}&select=updated_at&order=updated_at.desc&limit=1`
      );
      const sets: { updated_at: string }[] = await setsRes.json().catch(() => []);
      const hasSets = sets.length > 0;
      const lastActivity = hasSets ? new Date(sets[0].updated_at) : new Date(sess.started_at);

      const minutesInactive = (now.getTime() - lastActivity.getTime()) / 60000;
      if (minutesInactive < timeoutMin) continue;

      if (!hasSets) {
        // Butt start — delete everything silently
        await dbFetch(`zane_sets?session_id=eq.${sess.id}`, { method: 'DELETE' });
        await dbFetch(`zane_session_entries?session_id=eq.${sess.id}`, { method: 'DELETE' });
        await dbFetch(`zane_sessions?id=eq.${sess.id}`, { method: 'DELETE' });
        console.log(`[auto-close] deleted butt-start session ${sess.id}`);
        deleted++;
      } else {
        // Has sets — close with ended = last set's updated_at
        const startedAt = new Date(sess.started_at);
        const durationMinutes = Math.round((lastActivity.getTime() - startedAt.getTime()) / 60000);
        await dbFetch(`zane_sessions?id=eq.${sess.id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ ended: lastActivity.toISOString(), duration_minutes: durationMinutes }),
        });
        console.log(`[auto-close] closed session ${sess.id} (${durationMinutes} min)`);

        // Write notification for next app start
        await dbFetch(`zane_user_settings?user_id=eq.${sess.user_id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            auto_close_notify: {
              dayName: sess.day_name || 'Session',
              date: (sess.date || '').slice(0, 10),
              durationMinutes,
            },
          }),
        });

        if (sett?.push_enabled && sett?.pushover_user_key) {
          await sendPushover(
            sett.pushover_user_key,
            sess.user_id,
            `Session auto-ended after ${timeoutMin} min of inactivity (${durationMinutes} min total).`
          );
        }
        closed++;
      }

      // Clear in_progress_session_id if it still points at this session
      if (sett?.in_progress_session_id === sess.id) {
        await dbFetch(`zane_user_settings?user_id=eq.${sess.user_id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ in_progress_session_id: null }),
        });
      }
    }

    console.log(`[auto-close] done — closed: ${closed}, deleted: ${deleted}`);
    return { closed, deleted };
  };

  const result = await run().catch(e => { console.error('[auto-close] fatal:', e); return { error: String(e) }; });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
