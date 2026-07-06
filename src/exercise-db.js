/* ─── System Exercise Library (read-only "Exercise DB") ──────────────────────
   An original, curated catalogue of standard strength/hypertrophy movements in
   the app's own exercise shape. Ships as a static bundle (no per-user DB rows):
   plans/sessions may reference a `sys_…` id directly (read-only), and the user
   can DUPLICATE any entry into their own `zane_exercises` to customise it.

   NOT wired into the app yet — this is the data layer only. The Library
   "Exercise DB" tab, the id→exercise lookup merge, and the Duplicate flow come
   in a follow-up.

   Entry shape (compact — defaults keep the file small):
     { id, name, tags: [muscle…], equipment, movement, noWeight }
   Defaults when a field is omitted:
     movement → 'bilateral'   |   noWeight → false   |   category → null
   Vocabularies must match the app:
     tags      → Abs Back Biceps Calves Chest Forearms Glutes Hamstrings Quads Shoulders Triceps
     equipment → no_equipment bodyweight cable dumbbell barbell_dual machine barbell_single
     movement  → bilateral | unilateral | mobility
   Primary mover is listed first in `tags`. Multi-tag compounds count toward each
   tagged muscle in the sets-per-muscle view; retag after duplicating to taste. */
window.SYSTEM_EXERCISES = [
  // ── Chest ──────────────────────────────────────────────────────────────────
  { id: 'sys_barbell_bench_press',        name: 'Barbell Bench Press',          tags: ['Chest','Triceps','Shoulders'], equipment: 'barbell_dual' },
  { id: 'sys_incline_barbell_bench',      name: 'Incline Barbell Bench Press',  tags: ['Chest','Shoulders','Triceps'], equipment: 'barbell_dual' },
  { id: 'sys_decline_barbell_bench',      name: 'Decline Barbell Bench Press',  tags: ['Chest','Triceps'],             equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_bench_press',       name: 'Dumbbell Bench Press',         tags: ['Chest','Triceps','Shoulders'], equipment: 'dumbbell' },
  { id: 'sys_incline_dumbbell_press',     name: 'Incline Dumbbell Press',       tags: ['Chest','Shoulders','Triceps'], equipment: 'dumbbell' },
  { id: 'sys_decline_dumbbell_press',     name: 'Decline Dumbbell Press',       tags: ['Chest','Triceps'],             equipment: 'dumbbell' },
  { id: 'sys_machine_chest_press',        name: 'Machine Chest Press',          tags: ['Chest','Triceps'],             equipment: 'machine' },
  { id: 'sys_incline_machine_press',      name: 'Incline Machine Press',        tags: ['Chest','Shoulders','Triceps'], equipment: 'machine' },
  { id: 'sys_smith_bench_press',          name: 'Smith Machine Bench Press',    tags: ['Chest','Triceps'],             equipment: 'machine' },
  { id: 'sys_dumbbell_fly',               name: 'Dumbbell Fly',                 tags: ['Chest'],                       equipment: 'dumbbell' },
  { id: 'sys_incline_dumbbell_fly',       name: 'Incline Dumbbell Fly',         tags: ['Chest'],                       equipment: 'dumbbell' },
  { id: 'sys_cable_fly',                  name: 'Cable Fly',                    tags: ['Chest'],                       equipment: 'cable' },
  { id: 'sys_low_high_cable_fly',         name: 'Low-to-High Cable Fly',        tags: ['Chest'],                       equipment: 'cable' },
  { id: 'sys_high_low_cable_fly',         name: 'High-to-Low Cable Fly',        tags: ['Chest'],                       equipment: 'cable' },
  { id: 'sys_pec_deck',                   name: 'Pec Deck',                     tags: ['Chest'],                       equipment: 'machine' },
  { id: 'sys_chest_dip',                  name: 'Chest Dip',                    tags: ['Chest','Triceps'],             equipment: 'bodyweight' },
  { id: 'sys_push_up',                    name: 'Push-Up',                      tags: ['Chest','Triceps','Shoulders'], equipment: 'bodyweight', noWeight: true },

  // ── Back ───────────────────────────────────────────────────────────────────
  { id: 'sys_deadlift',                   name: 'Deadlift',                     tags: ['Back','Glutes','Hamstrings'],  equipment: 'barbell_dual' },
  { id: 'sys_rack_pull',                  name: 'Rack Pull',                    tags: ['Back','Glutes','Hamstrings'],  equipment: 'barbell_dual' },
  { id: 'sys_barbell_row',                name: 'Barbell Row',                  tags: ['Back','Biceps'],               equipment: 'barbell_dual' },
  { id: 'sys_pendlay_row',                name: 'Pendlay Row',                  tags: ['Back','Biceps'],               equipment: 'barbell_dual' },
  { id: 'sys_t_bar_row',                  name: 'T-Bar Row',                    tags: ['Back','Biceps'],               equipment: 'barbell_single' },
  { id: 'sys_dumbbell_row',               name: 'Single-Arm Dumbbell Row',      tags: ['Back','Biceps'],               equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_chest_supported_row',        name: 'Chest-Supported Dumbbell Row', tags: ['Back','Biceps'],               equipment: 'dumbbell' },
  { id: 'sys_meadows_row',                name: 'Meadows Row',                  tags: ['Back','Biceps'],               equipment: 'barbell_single', movement: 'unilateral' },
  { id: 'sys_seated_cable_row',           name: 'Seated Cable Row',             tags: ['Back','Biceps'],               equipment: 'cable' },
  { id: 'sys_lat_pulldown',               name: 'Lat Pulldown',                 tags: ['Back','Biceps'],               equipment: 'cable' },
  { id: 'sys_wide_grip_pulldown',         name: 'Wide-Grip Lat Pulldown',       tags: ['Back','Biceps'],               equipment: 'cable' },
  { id: 'sys_close_grip_pulldown',        name: 'Close-Grip Lat Pulldown',      tags: ['Back','Biceps'],               equipment: 'cable' },
  { id: 'sys_straight_arm_pulldown',      name: 'Straight-Arm Pulldown',        tags: ['Back'],                        equipment: 'cable' },
  { id: 'sys_machine_row',                name: 'Machine Row',                  tags: ['Back','Biceps'],               equipment: 'machine' },
  { id: 'sys_machine_high_row',           name: 'Machine High Row',             tags: ['Back','Biceps'],               equipment: 'machine' },
  { id: 'sys_pull_up',                    name: 'Pull-Up',                      tags: ['Back','Biceps'],               equipment: 'bodyweight' },
  { id: 'sys_chin_up',                    name: 'Chin-Up',                      tags: ['Back','Biceps'],               equipment: 'bodyweight' },
  { id: 'sys_inverted_row',               name: 'Inverted Row',                 tags: ['Back','Biceps'],               equipment: 'bodyweight', noWeight: true },
  { id: 'sys_dumbbell_pullover',          name: 'Dumbbell Pullover',            tags: ['Back','Chest'],                equipment: 'dumbbell' },
  { id: 'sys_barbell_shrug',              name: 'Barbell Shrug',                tags: ['Back'],                        equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_shrug',             name: 'Dumbbell Shrug',               tags: ['Back'],                        equipment: 'dumbbell' },

  // ── Shoulders ────────────────────────────────────────────────────────────────
  { id: 'sys_overhead_press',             name: 'Overhead Press',               tags: ['Shoulders','Triceps'],         equipment: 'barbell_dual' },
  { id: 'sys_seated_barbell_ohp',         name: 'Seated Barbell Overhead Press',tags: ['Shoulders','Triceps'],         equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_shoulder_press',    name: 'Dumbbell Shoulder Press',      tags: ['Shoulders','Triceps'],         equipment: 'dumbbell' },
  { id: 'sys_arnold_press',               name: 'Arnold Press',                 tags: ['Shoulders','Triceps'],         equipment: 'dumbbell' },
  { id: 'sys_machine_shoulder_press',     name: 'Machine Shoulder Press',       tags: ['Shoulders','Triceps'],         equipment: 'machine' },
  { id: 'sys_landmine_press',             name: 'Landmine Press',               tags: ['Shoulders','Triceps'],         equipment: 'barbell_single', movement: 'unilateral' },
  { id: 'sys_dumbbell_lateral_raise',     name: 'Dumbbell Lateral Raise',       tags: ['Shoulders'],                   equipment: 'dumbbell' },
  { id: 'sys_cable_lateral_raise',        name: 'Cable Lateral Raise',          tags: ['Shoulders'],                   equipment: 'cable', movement: 'unilateral' },
  { id: 'sys_machine_lateral_raise',      name: 'Machine Lateral Raise',        tags: ['Shoulders'],                   equipment: 'machine' },
  { id: 'sys_dumbbell_front_raise',       name: 'Dumbbell Front Raise',         tags: ['Shoulders'],                   equipment: 'dumbbell' },
  { id: 'sys_dumbbell_rear_delt_fly',     name: 'Dumbbell Rear Delt Fly',       tags: ['Shoulders'],                   equipment: 'dumbbell' },
  { id: 'sys_reverse_pec_deck',           name: 'Reverse Pec Deck',             tags: ['Shoulders'],                   equipment: 'machine' },
  { id: 'sys_face_pull',                  name: 'Face Pull',                    tags: ['Shoulders','Back'],            equipment: 'cable' },
  { id: 'sys_barbell_upright_row',        name: 'Barbell Upright Row',          tags: ['Shoulders','Back'],            equipment: 'barbell_dual' },
  { id: 'sys_cable_upright_row',          name: 'Cable Upright Row',            tags: ['Shoulders','Back'],            equipment: 'cable' },

  // ── Biceps ───────────────────────────────────────────────────────────────────
  { id: 'sys_barbell_curl',               name: 'Barbell Curl',                 tags: ['Biceps'],                      equipment: 'barbell_dual' },
  { id: 'sys_ez_bar_curl',                name: 'EZ-Bar Curl',                  tags: ['Biceps'],                      equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_curl',              name: 'Dumbbell Curl',                tags: ['Biceps'],                      equipment: 'dumbbell' },
  { id: 'sys_incline_dumbbell_curl',      name: 'Incline Dumbbell Curl',        tags: ['Biceps'],                      equipment: 'dumbbell' },
  { id: 'sys_hammer_curl',                name: 'Hammer Curl',                  tags: ['Biceps','Forearms'],           equipment: 'dumbbell' },
  { id: 'sys_concentration_curl',         name: 'Concentration Curl',           tags: ['Biceps'],                      equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_preacher_curl',              name: 'Preacher Curl',                tags: ['Biceps'],                      equipment: 'barbell_dual' },
  { id: 'sys_machine_preacher_curl',      name: 'Machine Preacher Curl',        tags: ['Biceps'],                      equipment: 'machine' },
  { id: 'sys_cable_curl',                 name: 'Cable Curl',                   tags: ['Biceps'],                      equipment: 'cable' },
  { id: 'sys_bayesian_cable_curl',        name: 'Bayesian Cable Curl',          tags: ['Biceps'],                      equipment: 'cable', movement: 'unilateral' },
  { id: 'sys_spider_curl',                name: 'Spider Curl',                  tags: ['Biceps'],                      equipment: 'dumbbell' },

  // ── Triceps ──────────────────────────────────────────────────────────────────
  { id: 'sys_close_grip_bench',           name: 'Close-Grip Bench Press',       tags: ['Triceps','Chest'],             equipment: 'barbell_dual' },
  { id: 'sys_triceps_pushdown_rope',      name: 'Rope Triceps Pushdown',        tags: ['Triceps'],                     equipment: 'cable' },
  { id: 'sys_triceps_pushdown_bar',       name: 'Bar Triceps Pushdown',         tags: ['Triceps'],                     equipment: 'cable' },
  { id: 'sys_overhead_cable_ext',         name: 'Overhead Cable Triceps Extension', tags: ['Triceps'],                 equipment: 'cable' },
  { id: 'sys_overhead_db_ext',            name: 'Overhead Dumbbell Extension',  tags: ['Triceps'],                     equipment: 'dumbbell' },
  { id: 'sys_skull_crusher',              name: 'Skull Crusher',                tags: ['Triceps'],                     equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_skull_crusher',     name: 'Dumbbell Skull Crusher',       tags: ['Triceps'],                     equipment: 'dumbbell' },
  { id: 'sys_triceps_dip',                name: 'Triceps Dip',                  tags: ['Triceps','Chest'],             equipment: 'bodyweight' },
  { id: 'sys_bench_dip',                  name: 'Bench Dip',                    tags: ['Triceps'],                     equipment: 'bodyweight', noWeight: true },
  { id: 'sys_dumbbell_kickback',          name: 'Dumbbell Kickback',            tags: ['Triceps'],                     equipment: 'dumbbell' },
  { id: 'sys_cable_kickback',             name: 'Cable Kickback',               tags: ['Triceps'],                     equipment: 'cable', movement: 'unilateral' },

  // ── Quads ────────────────────────────────────────────────────────────────────
  { id: 'sys_back_squat',                 name: 'Back Squat',                   tags: ['Quads','Glutes'],              equipment: 'barbell_dual' },
  { id: 'sys_front_squat',                name: 'Front Squat',                  tags: ['Quads','Glutes'],              equipment: 'barbell_dual' },
  { id: 'sys_hack_squat',                 name: 'Hack Squat',                   tags: ['Quads','Glutes'],              equipment: 'machine' },
  { id: 'sys_pendulum_squat',             name: 'Pendulum Squat',               tags: ['Quads','Glutes'],              equipment: 'machine' },
  { id: 'sys_leg_press',                  name: 'Leg Press',                    tags: ['Quads','Glutes'],              equipment: 'machine' },
  { id: 'sys_leg_extension',              name: 'Leg Extension',                tags: ['Quads'],                       equipment: 'machine' },
  { id: 'sys_smith_squat',                name: 'Smith Machine Squat',          tags: ['Quads','Glutes'],              equipment: 'machine' },
  { id: 'sys_goblet_squat',               name: 'Goblet Squat',                 tags: ['Quads','Glutes'],              equipment: 'dumbbell' },
  { id: 'sys_bulgarian_split_squat',      name: 'Bulgarian Split Squat',        tags: ['Quads','Glutes'],              equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_walking_lunge',              name: 'Walking Lunge',                tags: ['Quads','Glutes'],              equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_reverse_lunge',              name: 'Reverse Lunge',                tags: ['Quads','Glutes'],              equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_dumbbell_step_up',           name: 'Dumbbell Step-Up',             tags: ['Quads','Glutes'],              equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_sissy_squat',                name: 'Sissy Squat',                  tags: ['Quads'],                       equipment: 'bodyweight', noWeight: true },

  // ── Hamstrings ───────────────────────────────────────────────────────────────
  { id: 'sys_romanian_deadlift',          name: 'Romanian Deadlift',            tags: ['Hamstrings','Glutes'],         equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_rdl',               name: 'Dumbbell Romanian Deadlift',   tags: ['Hamstrings','Glutes'],         equipment: 'dumbbell' },
  { id: 'sys_stiff_leg_deadlift',         name: 'Stiff-Leg Deadlift',           tags: ['Hamstrings','Glutes'],         equipment: 'barbell_dual' },
  { id: 'sys_single_leg_rdl',             name: 'Single-Leg Romanian Deadlift', tags: ['Hamstrings','Glutes'],         equipment: 'dumbbell', movement: 'unilateral' },
  { id: 'sys_lying_leg_curl',             name: 'Lying Leg Curl',               tags: ['Hamstrings'],                  equipment: 'machine' },
  { id: 'sys_seated_leg_curl',            name: 'Seated Leg Curl',              tags: ['Hamstrings'],                  equipment: 'machine' },
  { id: 'sys_nordic_curl',                name: 'Nordic Hamstring Curl',        tags: ['Hamstrings'],                  equipment: 'bodyweight', noWeight: true },
  { id: 'sys_good_morning',               name: 'Good Morning',                 tags: ['Hamstrings','Glutes','Back'],  equipment: 'barbell_dual' },
  { id: 'sys_cable_pull_through',         name: 'Cable Pull-Through',           tags: ['Glutes','Hamstrings'],         equipment: 'cable' },

  // ── Glutes ───────────────────────────────────────────────────────────────────
  { id: 'sys_hip_thrust',                 name: 'Barbell Hip Thrust',           tags: ['Glutes','Hamstrings'],         equipment: 'barbell_dual' },
  { id: 'sys_machine_hip_thrust',         name: 'Machine Hip Thrust',           tags: ['Glutes'],                      equipment: 'machine' },
  { id: 'sys_barbell_glute_bridge',       name: 'Barbell Glute Bridge',         tags: ['Glutes'],                      equipment: 'barbell_dual' },
  { id: 'sys_sumo_deadlift',              name: 'Sumo Deadlift',                tags: ['Glutes','Hamstrings','Quads'], equipment: 'barbell_dual' },
  { id: 'sys_hip_abduction_machine',      name: 'Hip Abduction Machine',        tags: ['Glutes'],                      equipment: 'machine' },
  { id: 'sys_cable_glute_kickback',       name: 'Cable Glute Kickback',         tags: ['Glutes'],                      equipment: 'cable', movement: 'unilateral' },

  // ── Calves ───────────────────────────────────────────────────────────────────
  { id: 'sys_standing_calf_raise',        name: 'Standing Calf Raise',          tags: ['Calves'],                      equipment: 'machine' },
  { id: 'sys_seated_calf_raise',          name: 'Seated Calf Raise',            tags: ['Calves'],                      equipment: 'machine' },
  { id: 'sys_leg_press_calf_raise',       name: 'Leg Press Calf Raise',         tags: ['Calves'],                      equipment: 'machine' },
  { id: 'sys_dumbbell_calf_raise',        name: 'Dumbbell Standing Calf Raise', tags: ['Calves'],                      equipment: 'dumbbell' },
  { id: 'sys_smith_calf_raise',           name: 'Smith Machine Calf Raise',     tags: ['Calves'],                      equipment: 'machine' },

  // ── Abs ──────────────────────────────────────────────────────────────────────
  { id: 'sys_hanging_leg_raise',          name: 'Hanging Leg Raise',            tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_hanging_knee_raise',         name: 'Hanging Knee Raise',           tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_cable_crunch',               name: 'Cable Crunch',                 tags: ['Abs'],                         equipment: 'cable' },
  { id: 'sys_machine_crunch',             name: 'Machine Crunch',               tags: ['Abs'],                         equipment: 'machine' },
  { id: 'sys_crunch',                     name: 'Crunch',                       tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_sit_up',                     name: 'Sit-Up',                       tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_lying_leg_raise',            name: 'Lying Leg Raise',              tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_plank',                      name: 'Plank',                        tags: ['Abs'],                         equipment: 'bodyweight', noWeight: true },
  { id: 'sys_ab_wheel_rollout',           name: 'Ab Wheel Rollout',             tags: ['Abs'],                         equipment: 'no_equipment', noWeight: true },
  { id: 'sys_cable_woodchopper',          name: 'Cable Woodchopper',            tags: ['Abs'],                         equipment: 'cable', movement: 'unilateral' },

  // ── Forearms ─────────────────────────────────────────────────────────────────
  { id: 'sys_barbell_wrist_curl',         name: 'Barbell Wrist Curl',           tags: ['Forearms'],                    equipment: 'barbell_dual' },
  { id: 'sys_barbell_reverse_wrist_curl', name: 'Barbell Reverse Wrist Curl',   tags: ['Forearms'],                    equipment: 'barbell_dual' },
  { id: 'sys_dumbbell_wrist_curl',        name: 'Dumbbell Wrist Curl',          tags: ['Forearms'],                    equipment: 'dumbbell' },
  { id: 'sys_reverse_curl',               name: 'Reverse Curl',                 tags: ['Forearms','Biceps'],           equipment: 'barbell_dual' },
  { id: 'sys_cable_reverse_curl',         name: 'Cable Reverse Curl',           tags: ['Forearms','Biceps'],           equipment: 'cable' },
  { id: 'sys_farmers_carry',              name: "Farmer's Carry",               tags: ['Forearms','Back'],             equipment: 'dumbbell' },
];
