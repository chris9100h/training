// Pre-built beginner programs - read-only catalog, plain JS (like exercise-db.js
// and whatsnew.js: a normal <script> in index.html, listed in ASSETS in sw.js).
// Exposes window.SYSTEM_PROGRAMS, consumed by the "Templates" fork of the plan
// creation flow and materialized into an editable plan by LB.instantiateProgram.
//
// Design (confirmed with the app owner): beginner audience, delivered as FLEX
// mesocycles (advance on a logged session, no fixed weekdays), organized by "how
// many days can you train?" - one strong program per frequency. Current-trend
// volume: 2 working sets per exercise, more exercise variety, ~16 sets/session.
// Exercises are referenced by their EXACT catalog name (window.SYSTEM_EXERCISES);
// tools/test/store.test.cjs validates every name resolves. Reps are Range mode.
//
// Fixed exercise-order rules (owner): on any day that trains legs a SEATED leg
// curl leads (hamstrings pumped first), then Leg Extension, then the heavy leg
// movements (unilateral split-squat work before the big bilateral compound);
// calves always come last on days that train them.
(function () {
  // Item shorthand: r(name, repsFloor, repsCeil, sets=2)
  const r = (ex, lo, hi, sets) => ({ ex, sets: sets || 2, reps: lo, repsMax: hi });
  const MESO = { weeks: 6, startRir: 3, endRir: 0 };

  window.SYSTEM_PROGRAMS = [
    {
      id: "prog_fb2", name: "Full Body 2x", daysPerWeek: 2, level: "Beginner",
      blurb: "Two full-body sessions a week. Everything trained twice, in and out fast. The lowest-commitment way to start.",
      meso: MESO,
      days: [
        { name: "Full Body A", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Press", 10, 15),
          r("Machine Chest Press", 8, 12),
          r("Lat Pulldown", 8, 12),
          r("Dumbbell Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Dumbbell Curl", 10, 15),
          r("Rope Triceps Pushdown", 10, 15),
        ] },
        { name: "Full Body B", items: [
          r("Seated Leg Curl", 10, 15),
          r("Hack Squat", 10, 15),
          r("Incline Dumbbell Press", 8, 12),
          r("Seated Cable Row", 8, 12),
          r("Cable Lateral Raise", 12, 20),
          r("Cable Curl", 10, 15),
          r("Overhead Cable Triceps Extension", 10, 15),
          r("Standing Calf Raise", 10, 15),
        ] },
      ],
    },
    {
      id: "prog_fb3", name: "Full Body 3x", daysPerWeek: 3, level: "Beginner",
      blurb: "The classic beginner pick. Three full-body sessions, each muscle trained three times a week for the fastest early progress.",
      meso: MESO,
      days: [
        { name: "Full Body A", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Press", 10, 15),
          r("Machine Chest Press", 8, 12),
          r("Lat Pulldown", 8, 12),
          r("Dumbbell Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Dumbbell Curl", 10, 15),
          r("Rope Triceps Pushdown", 10, 15),
        ] },
        { name: "Full Body B", items: [
          r("Seated Leg Curl", 10, 15),
          r("Hack Squat", 10, 15),
          r("Incline Dumbbell Press", 8, 12),
          r("Seated Cable Row", 8, 12),
          r("Cable Lateral Raise", 12, 20),
          r("EZ-Bar Curl", 10, 15),
          r("Bar Triceps Pushdown", 10, 15),
          r("Standing Calf Raise", 10, 15),
        ] },
        { name: "Full Body C", items: [
          r("Seated Leg Curl", 10, 15),
          r("Romanian Deadlift", 8, 12),
          r("Pec Deck", 12, 15),
          r("Neutral-Grip Lat Pulldown", 8, 12),
          r("Machine Shoulder Press", 10, 12),
          r("Reverse Pec Deck", 12, 20),
          r("Hammer Curl", 10, 15),
          r("Overhead Cable Triceps Extension", 10, 15),
        ] },
      ],
    },
    {
      id: "prog_ul4", name: "Upper / Lower", daysPerWeek: 4, level: "Beginner",
      blurb: "Four days, split into two upper and two lower sessions. More volume per muscle once three full-body days is not enough.",
      meso: MESO,
      days: [
        { name: "Upper A", items: [
          r("Machine Chest Press", 8, 12),
          r("Incline Dumbbell Press", 8, 12),
          r("Lat Pulldown", 8, 12),
          r("Seated Cable Row", 8, 12),
          r("Dumbbell Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Dumbbell Curl", 10, 15),
          r("Rope Triceps Pushdown", 10, 15),
        ] },
        { name: "Lower A", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Bulgarian Split Squat", 10, 12),
          r("Leg Press", 10, 15),
          r("Dumbbell Romanian Deadlift", 10, 12),
          r("Machine Hip Thrust", 10, 15),
          r("Cable Crunch", 12, 20),
          r("Standing Calf Raise", 10, 15),
        ] },
        { name: "Upper B", items: [
          r("Incline Machine Press", 8, 12),
          r("Pec Deck", 12, 15),
          r("Neutral-Grip Lat Pulldown", 8, 12),
          r("Chest-Supported T-Bar Row", 10, 12),
          r("Cable Lateral Raise", 12, 20),
          r("Reverse Pec Deck", 12, 20),
          r("Hammer Curl", 10, 15),
          r("Overhead Cable Triceps Extension", 10, 15),
        ] },
        { name: "Lower B", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Hack Squat", 10, 15),
          r("Dumbbell Romanian Deadlift", 10, 12),
          r("Machine Hip Thrust", 10, 15),
          r("Walking Lunge", 10, 12),
          r("Hanging Knee Raise", 12, 15),
          r("Seated Calf Raise", 10, 15),
        ] },
      ],
    },
    {
      id: "prog_ppl5", name: "Push Pull Legs U/L", daysPerWeek: 5, level: "Beginner",
      blurb: "Five days: push, pull, legs, then an upper and a lower. A big weekly dose of variety once you are training most days.",
      meso: MESO,
      days: [
        { name: "Push", items: [
          r("Machine Chest Press", 8, 12),
          r("Incline Dumbbell Press", 8, 12),
          r("Pec Deck", 12, 15),
          r("Machine Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Cable Lateral Raise", 12, 20),
          r("Rope Triceps Pushdown", 10, 15),
          r("Overhead Cable Triceps Extension", 10, 15),
        ] },
        { name: "Pull", items: [
          r("Lat Pulldown", 8, 12),
          r("Seated Cable Row", 8, 12),
          r("Chest-Supported T-Bar Row", 10, 12),
          r("Neutral-Grip Lat Pulldown", 8, 12),
          r("Reverse Pec Deck", 12, 20),
          r("Face Pull", 12, 20),
          r("Dumbbell Curl", 10, 15),
          r("Cable Curl", 10, 15),
        ] },
        { name: "Legs", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Bulgarian Split Squat", 10, 12),
          r("Leg Press", 10, 15),
          r("Dumbbell Romanian Deadlift", 10, 12),
          r("Machine Hip Thrust", 10, 15),
          r("Cable Crunch", 12, 20),
          r("Standing Calf Raise", 10, 15),
        ] },
        { name: "Upper", items: [
          r("Incline Machine Press", 8, 12),
          r("Machine Chest Press", 8, 12),
          r("Wide-Grip Lat Pulldown", 8, 12),
          r("Single-Arm Dumbbell Row", 10, 12),
          r("Dumbbell Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Hammer Curl", 10, 15),
          r("Bar Triceps Pushdown", 10, 15),
        ] },
        { name: "Lower", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Bulgarian Split Squat", 10, 12),
          r("Hack Squat", 10, 15),
          r("Dumbbell Romanian Deadlift", 10, 12),
          r("Machine Hip Thrust", 10, 15),
          r("Hanging Knee Raise", 12, 15),
          r("Standing Calf Raise", 10, 15),
        ] },
      ],
    },
    {
      id: "prog_ppl6", name: "PPL x2", daysPerWeek: 6, level: "Beginner",
      blurb: "Six days: push, pull and legs run twice with fresh exercises each time. For the committed beginner who wants to be in the gym most days.",
      meso: MESO,
      days: [
        { name: "Push A", items: [
          r("Machine Chest Press", 8, 12),
          r("Incline Dumbbell Press", 8, 12),
          r("Pec Deck", 12, 15),
          r("Machine Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Cable Lateral Raise", 12, 20),
          r("Rope Triceps Pushdown", 10, 15),
          r("Overhead Dumbbell Extension", 10, 15),
        ] },
        { name: "Pull A", items: [
          r("Lat Pulldown", 8, 12),
          r("Seated Cable Row", 8, 12),
          r("Chest-Supported T-Bar Row", 10, 12),
          r("Reverse Pec Deck", 12, 20),
          r("Face Pull", 12, 20),
          r("Dumbbell Shrug", 10, 15),
          r("Dumbbell Curl", 10, 15),
          r("Cable Curl", 10, 15),
        ] },
        { name: "Legs A", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Leg Press", 10, 15),
          r("Dumbbell Romanian Deadlift", 10, 12),
          r("Machine Hip Thrust", 10, 15),
          r("Walking Lunge", 10, 12),
          r("Cable Crunch", 12, 20),
          r("Standing Calf Raise", 10, 15),
        ] },
        { name: "Push B", items: [
          r("Incline Machine Press", 8, 12),
          r("Dumbbell Bench Press", 8, 12),
          r("Cable Fly", 12, 15),
          r("Dumbbell Shoulder Press", 10, 12),
          r("Machine Lateral Raise", 12, 20),
          r("Dumbbell Front Raise", 12, 15),
          r("Bar Triceps Pushdown", 10, 15),
          r("Overhead Cable Triceps Extension", 10, 15),
        ] },
        { name: "Pull B", items: [
          r("Neutral-Grip Lat Pulldown", 8, 12),
          r("Machine Row", 10, 12),
          r("Single-Arm Dumbbell Row", 10, 12),
          r("Straight-Arm Pulldown", 12, 15),
          r("Cable Rear Delt Fly", 12, 20),
          r("Face Pull", 12, 20),
          r("EZ-Bar Curl", 10, 15),
          r("Hammer Curl", 10, 15),
        ] },
        { name: "Legs B", items: [
          r("Seated Leg Curl", 10, 15),
          r("Leg Extension", 12, 20),
          r("Bulgarian Split Squat", 10, 12),
          r("Hack Squat", 10, 15),
          r("Leg Press", 10, 15),
          r("Machine Hip Thrust", 10, 15),
          r("Hanging Knee Raise", 12, 15),
          r("Standing Calf Raise", 10, 15),
        ] },
      ],
    },
  ];

  // Wendler 5/3/1. Structurally different from the rep-range programs above
  // (percentages off a per-lift Training Max, not rep ranges), so it lives on
  // its own global. The setup wizard reads this for the lift list + default
  // assistance suggestions; LB.build531Plan turns a filled-in config into a
  // schedule with program_type '531'. Every name here must resolve in
  // window.SYSTEM_EXERCISES (store.test.cjs guards it).
  window.FIVE_THREE_ONE = {
    id: "prog_531", name: "5/3/1", level: "Intermediate",
    blurb: "Wendler's classic strength base. Four main lifts, each driven off a Training Max, waving 5s / 3s / 1s across a 4-week cycle. Slow, boring, and it just works.",
    lifts: [
      { kind: "squat", ex: "Back Squat" },
      { kind: "bench", ex: "Barbell Bench Press" },
      { kind: "deadlift", ex: "Deadlift" },
      { kind: "ohp", ex: "Overhead Press" },
    ],
    // Default assistance per lift (the wizard lets the user swap these and pick
    // up to 3). Lean, machine/dumbbell friendly, one push/pull/leg/core-ish mix.
    assistance: {
      squat: ["Leg Press", "Seated Leg Curl", "Standing Calf Raise"],
      bench: ["Incline Dumbbell Press", "Seated Cable Row", "Rope Triceps Pushdown"],
      deadlift: ["Hanging Leg Raise", "Lat Pulldown", "Seated Leg Curl"],
      ohp: ["Machine Lateral Raise", "Chin-Up", "Overhead Cable Triceps Extension"],
    },
  };
})();
