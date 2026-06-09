/* ─── What's New — changelog history ────────────────────────────────────────
   The full announcement history lives here, NEWEST FIRST. app.jsx reads
   window.WHATS_NEW and shows every entry the user hasn't seen yet, bundled into
   a single card — so someone returning after skipping several releases catches
   up on everything at once. See CLAUDE.md "What's New / Changelog".

   To announce something (ONLY on the user's request):
     1. Add a new entry to the TOP of the array with a fresh, unique `id`.
     2. Bump the sw.js cache version so the update ships.
   Never remove old entries — they are the history returning users catch up on.
   Write the texts well: what's new, what it does for the user, how to use it —
   crisp bullet points, no tech jargon, no internal names. Leave the array
   empty ([]) to show nothing.

   Entry shape: { id: string, title: string, items: string[] } */
window.WHATS_NEW = [
  {
    id: 'v2.065',
    title: 'Faster, offline & flexible plans',
    items: [
      'The app now starts much faster and works fully offline — open it anytime, even without a connection, and your training is right there.',
      'Plans keep a dated version history. Change your split starting from any date you choose, then browse or bring back earlier versions anytime in the plan view.',
      "Coaching: while following a client's live session you can now scroll through their whole workout freely — tap LIVE to jump back to the exercise they're on right now.",
    ],
  },
];
