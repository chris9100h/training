const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, title: 'Zane', userKey, userId }),
  }).catch(e => console.error('[auto-close] pushover error:', e));
}

async function sendWebPush(userId: string, title: string, message: string) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return fetch(`${base}/functions/v1/web-push`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title, message }),
  }).catch(e => console.error('[auto-close] web-push error:', e));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron-only shared secret. This function is a cron trigger target with no
  // caller identity to resolve (unlike pushover/index.ts), so it just checks
  // the bearer token against CRON_SECRET. Fails CLOSED: an unset/empty
  // CRON_SECRET rejects every request rather than accidentally allowing it
  // through. See migration 0230_cron_shared_secret_auth.sql for the
  // Vault-backed secret this compares against. auto-close-sessions is
  // scheduled via the Supabase Dashboard (not an in-repo migration), so its
  // schedule's Authorization header must be updated there by hand, see the
  // migration's top comment.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const run = async () => {
    const now = new Date();

    // All open sessions including day_name and date for the notification
    const sessRes = await dbFetch('zane_sessions?ended=is.null&select=id,user_id,started_at,day_name,date');
    // The `.catch(() => [])` fallbacks below only cover a malformed BODY. On a
    // non-2xx PostgREST reply the body parses fine as an error OBJECT, so the
    // fallback never fires and the loop iterates an object, throwing a
    // TypeError that run().catch() swallows. Check the status, like
    // water-reminder already does.
    if (!sessRes.ok) {
      console.error(`[auto-close] sessions query failed: ${sessRes.status} ${await sessRes.text().catch(() => '')}`);
      return { closed: 0, deleted: 0 };
    }
    const sessions: { id: string; user_id: string; started_at: string; day_name: string; date: string }[] = await sessRes.json().catch(() => []);

    let closed = 0, deleted = 0;

    for (const sess of sessions) {
      // User settings
      const settRes = await dbFetch(
        `zane_user_settings?user_id=eq.${sess.user_id}&select=session_timeout_minutes,push_enabled,pushover_user_key,use_pushover,in_progress_session_id,status_mode`
      );
      // Same non-2xx-reply hazard as sessRes above (an error OBJECT, not the
      // malformed-body fallback): left unchecked, `sett` silently resolves to
      // undefined and every field it feeds (timeoutMin, isTracked below)
      // falls back to a default instead of this session being safely skipped.
      if (!settRes.ok) {
        console.error(`[auto-close] settings query failed for user ${sess.user_id}: ${settRes.status} ${await settRes.text().catch(() => '')}`);
        continue;
      }
      const [sett] = await settRes.json().catch(() => [null]);
      const timeoutMin: number = sett?.session_timeout_minutes ?? 90;

      // Last set activity
      const setsRes = await dbFetch(
        `zane_sets?session_id=eq.${sess.id}&select=updated_at&order=updated_at.desc&limit=1`
      );
      // Critical guard: on a non-2xx reply the `.catch(() => [])` fallback
      // never fires (the body parses fine as an error OBJECT), so `sets`
      // would silently resolve to that object, `sets.length` reads
      // undefined, hasSets becomes false, and a LIVE tracked session with
      // real sets gets routed into the "butt start, delete everything
      // silently" branch below, hard-deleting a workout that's still running.
      if (!setsRes.ok) {
        console.error(`[auto-close] sets query failed for session ${sess.id}: ${setsRes.status} ${await setsRes.text().catch(() => '')}`);
        continue;
      }
      const sets: { updated_at: string }[] = await setsRes.json().catch(() => []);
      const hasSets = sets.length > 0;
      // started_at is legitimately NULL until the last warmup set completes
      // ("start with warmup"), but the seeded sets themselves sync right
      // away, so hasSets is true well before started_at is ever set. Prefer
      // the real set timestamp whenever one exists; only fall back to
      // started_at (and then to "now", i.e. not yet inactive) when there's
      // truly no activity of any kind to go on.
      const lastActivity = hasSets ? new Date(sets[0].updated_at) : (sess.started_at ? new Date(sess.started_at) : now);

      const minutesInactive = (now.getTime() - lastActivity.getTime()) / 60000;
      if (minutesInactive < timeoutMin) continue;

      // A session that isn't this user's currently-tracked in-progress one is
      // an orphan (lost cross-device start race, or a local abandon/delete
      // that hasn't synced yet). This used to hard-delete every one of them,
      // justified as mirroring the client's boot reconciliation, which it
      // did NOT: store.js loadFromSupabase (the `orphanIds` filter) deletes
      // an orphan only when it is genuinely empty, no entry rows AND an
      // exercise_count aggregate of 0, and its comment states outright that
      // an orphan with real logged data is left alone so that this cron ENDS
      // it later via the timeout. The delete therefore destroyed exactly the
      // workouts the client had preserved for us. The faithful mirror is to
      // split on hasSets the same way the tracked path does: empty orphan is
      // thrown away, orphan with sets is a real workout and gets closed.
      // Untracked only changes who gets told (see the notification below),
      // never whether the data survives.
      const isTracked = sett?.in_progress_session_id === sess.id;

      if (!hasSets) {
        // Butt start when tracked, empty orphan when not. Nothing was ever
        // logged either way, delete everything silently.
        await dbFetch(`zane_sets?session_id=eq.${sess.id}`, { method: 'DELETE' });
        await dbFetch(`zane_session_entries?session_id=eq.${sess.id}`, { method: 'DELETE' });
        await dbFetch(`zane_sessions?id=eq.${sess.id}`, { method: 'DELETE' });
        console.log(`[auto-close] deleted ${isTracked ? 'butt-start' : 'empty untracked orphan'} session ${sess.id}`);
        deleted++;
      } else {
        // Has sets, close with ended = last set's updated_at. started_at is
        // legitimately NULL until the last warmup set completes ("start with
        // warmup"), so a session abandoned mid-warmup has no real start time
        // to compute a duration from, leave duration_minutes unset rather
        // than let `new Date(null)` (epoch 1970) silently produce a
        // multi-million-minute duration.
        const startedAt = sess.started_at ? new Date(sess.started_at) : null;
        const durationMinutes = startedAt ? Math.round((lastActivity.getTime() - startedAt.getTime()) / 60000) : null;
        const closeResp = await dbFetch(`zane_sessions?id=eq.${sess.id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          // Stamp is_cleanup the way the in-app finish does (migration 0251).
          // The app normally sets it; a session closed here never ran that
          // code, and an unflagged cleanup session is worse than an unflagged
          // deload one: it keeps signal_weight 'full' by design, so it would
          // feed detectStall and the PR baselines with its deliberately
          // reduced loads and report a stall on a lift that was only ever
          // meant to be light.
          body: JSON.stringify({ ended: lastActivity.toISOString(), ...(durationMinutes != null ? { duration_minutes: durationMinutes } : {}), ...(sett?.status_mode === 'cleanup' ? { is_cleanup: true } : {}) }),
        });
        // Unlike the three read queries above, this write was never checked:
        // a transient non-2xx here (still `ok`-checkable, dbFetch never
        // throws on it) left the session open but the very next line cleared
        // in_progress_session_id unconditionally anyway. The next tick then
        // saw isTracked=false for a session that never actually closed and
        // hard-deleted it as an "orphan", sets and all. Skip to the next
        // session instead, session stays open and tracked, this same close
        // is retried next tick.
        if (!closeResp.ok) {
          console.error(`[auto-close] close-PATCH failed for session ${sess.id}: ${closeResp.status} ${await closeResp.text().catch(() => '')}`);
          continue;
        }
        console.log(`[auto-close] closed ${isTracked ? '' : 'untracked '}session ${sess.id} (${durationMinutes ?? 'unknown'} min)`);

        // Notify only for the session this user's device still tracks as in
        // progress. An untracked one is a session that device has already
        // moved on from, and the usual cause (a lost cross-device start race)
        // means a DIFFERENT session may be live right now, so "Session ended"
        // would be plain wrong; auto_close_notify is also a single slot, so
        // it would overwrite the pending notice for the real session on top
        // of that. Saving the sets is the point of closing an orphan, the
        // notification isn't, and a silent close is still infinitely better
        // than the delete this branch used to do.
        if (isTracked) {
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

          if (sett?.push_enabled) {
            const msg = durationMinutes != null
              ? `Session auto-ended after ${timeoutMin} min of inactivity (${durationMinutes} min total).`
              : `Session auto-ended after ${timeoutMin} min of inactivity.`;
            // Pushover INSTEAD of Web Push when the user chose that channel, the
            // same rule the three reminder functions follow. This used to send
            // both whenever a key existed, so a Pushover user got every
            // auto-close twice.
            const viaPushover = !!sett.use_pushover && !!sett.pushover_user_key;
            if (viaPushover) {
              await sendPushover(sett.pushover_user_key, sess.user_id, msg);
            } else {
              await sendWebPush(sess.user_id, 'Zane · Session ended', msg);
            }
          }
        }
        closed++;
      }

      // Clear in_progress_session_id, scoped to still pointing at this
      // session AT THE MOMENT OF THE WRITE, not just when `sett` was fetched
      // at the top of this loop iteration. Several awaits sit in between
      // (the sets query, the close-PATCH, the notify write, the push send):
      // another device starting a brand new session for this same user in
      // that window would otherwise have its own fresh pointer nulled by
      // this same PATCH (a plain JS `if` on the stale `sett` snapshot can't
      // see that), and the next tick's isTracked/orphan check would then
      // hard-delete that live session with all its sets, same data-loss
      // class as the close-PATCH check above, just the other direction
      // (H2-Rest, audit-2026-08 verification pass). Scoping the PATCH
      // itself on in_progress_session_id=eq.<id> makes it an atomic
      // conditional update: a race makes this a no-op instead of a wrong
      // write. Untracked sessions reach this line too now that they no
      // longer `continue` out early, and that is fine for the same reason:
      // the pointer by definition points elsewhere, so the scope matches
      // nothing. Guarding it with a plain `if (isTracked)` would be exactly
      // the stale-snapshot decision this scoping exists to avoid, and in the
      // one case where the scope does match (a device re-adopted this id
      // while we were closing/deleting it) nulling a pointer to an ended or
      // gone session is the right repair anyway: the column is plain text,
      // no FK, so nothing else clears it.
      await dbFetch(`zane_user_settings?user_id=eq.${sess.user_id}&in_progress_session_id=eq.${sess.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ in_progress_session_id: null }),
      });
    }

    console.log(`[auto-close] done, closed: ${closed}, deleted: ${deleted}`);
    return { closed, deleted };
  };

  const result = await run().catch(e => { console.error('[auto-close] fatal:', e); return { error: String(e) }; });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
