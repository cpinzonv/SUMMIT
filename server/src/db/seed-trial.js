/**
 * ============================================================================
 * Summit — TRIAL DATASET seeder
 * ----------------------------------------------------------------------------
 * Populates ONE dedicated trial account with a full, deliberately messy,
 * realistic semester so every Summit feature can be exercised against real data.
 * See docs/TRIAL.md for the scenario → feature map.
 *
 * TRIAL ACCOUNT
 *   email     trial@student.app   (override with --email=you@example.com)
 *   password  TrialStudent#2026
 * The account is created if missing with role 'demo' — the project's established
 * full-access pattern (see server/src/db/seed.js): demo/admin bypass the paywall
 * so every paywalled Learn format is usable regardless of the BILLING_ENABLED
 * flag, and the computed `premium` flag the client reads is true. (A plain 'user'
 * + premium_whitelist grants access at the API but leaves the login response's
 * `premium` flag false, so the client would still render Learn as locked.)
 *
 * HOW TO RUN  (this is a CLI script, NOT an HTTP endpoint — /admin/seed-database
 * stays untouched). dotenv loads server/.env, so run it from the server workspace:
 *
 *   # local
 *   cd server && node src/db/seed-trial.js              # seed (no-op if already seeded)
 *   cd server && node src/db/seed-trial.js --reset      # wipe the trial account + reseed
 *
 *   # against a remote / Railway database
 *   railway run node src/db/seed-trial.js --reset --yes-i-mean-it
 *
 * FLAGS
 *   --reset            Wipe the trial account's data and rebuild from scratch.
 *   --yes-i-mean-it    Required when DATABASE_URL points at a production-looking
 *                      database (NODE_ENV=production or a non-local host). The
 *                      seeder only ever touches the single trial account, but
 *                      this makes running against prod a deliberate act.
 *   --email=ADDR       Target a different trial email (still one account only).
 *   --term="Fall 2026" Pin the term label (default: derived from the anchor date).
 *   --today=YYYY-MM-DD Pin "today" (otherwise the run date). The whole semester
 *                      is anchored around this so the account always looks
 *                      mid-semester: past attendance, overdue + due-today work,
 *                      a busy week, and future deadlines all light up.
 *
 * SAFETY
 *   • Only ever reads/writes rows belonging to the trial account. No other
 *     account's data is touched — every delete is scoped to the trial user id.
 *   • The wipe reuses the PR #77 purge-cascade order: delete the three tables
 *     that hold the user's rows via SET NULL / no-FK (security_events,
 *     gate_events, audit_logs), then DELETE FROM users so ON DELETE CASCADE
 *     removes everything else with nothing orphaned.
 *   • Features that live on unmerged branches (Degree Requirements) are
 *     table-detected: seeded when their tables exist, skipped with a note
 *     otherwise. Nothing here creates or alters schema.
 * ============================================================================
 */
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';
import { generateSessionDates } from '../utils/sessions.js';

// ----------------------------------------------------------------------------
// Args + config
// ----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const getOpt = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const RESET = hasFlag('--reset');
const YES_PROD = hasFlag('--yes-i-mean-it');
const EMAIL = (getOpt('--email') || 'trial@student.app').toLowerCase();
const PASSWORD = 'TrialStudent#2026';
const TIMEZONE = 'America/Chicago'; // Loyola-ish; exercises user-tz rendering
const TODAY_OVERRIDE = getOpt('--today');

// Brand palette (docs/brand/summit-brand-kit.html) so class cards look on-brand.
const COLORS = {
  coral: '#ff7a52',
  sky: '#4f9fd6',
  teal: '#3fb8c0',
  hero: '#ff8a4c',
  sunset: '#ff6f73',
  violet: '#7a6ff0',
};

// ----------------------------------------------------------------------------
// Production guard — the seeder only touches one account, but running it against
// a real database should be a deliberate choice.
// ----------------------------------------------------------------------------
function looksLikeProd() {
  if (process.env.NODE_ENV === 'production') return true;
  const url = process.env.DATABASE_URL || '';
  // Local dev hosts are safe; anything else (railway/render/supabase/…) is "prod-like".
  return !/@(localhost|127\.0\.0\.1|::1)[:/ ]/.test(url) && !/@[^/]*\.local\b/.test(url);
}

// ----------------------------------------------------------------------------
// Date helpers. Everything is anchored to "today" so the account is always
// mid-semester. Timestamps land at local noon so a due/attendance DAY never
// crosses a calendar boundary under normal server↔user timezone offsets.
// ----------------------------------------------------------------------------
const TODAY = (() => {
  if (TODAY_OVERRIDE && /^\d{4}-\d{2}-\d{2}$/.test(TODAY_OVERRIDE)) {
    const [y, m, d] = TODAY_OVERRIDE.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
})();

/** A Date `n` days from today, at 12:00 local. */
const day = (n, hour = 12, min = 0) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  d.setHours(hour, min, 0, 0);
  return d;
};
/** 'YYYY-MM-DD' for a Date (local calendar). */
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** 'YYYY-MM-DD' for a day offset. */
const dateOff = (n) => ymd(day(n));

// The semester brackets today: ~9 weeks elapsed, ~7 to go (a ~16-week term).
const SEMESTER_START = dateOff(-63);
const SEMESTER_END = dateOff(49);
// Term label derived from the start month so it reads naturally whenever it
// runs; override with --term="Fall 2026" to pin a specific label.
const TERM = getOpt('--term') || (() => {
  const [y, m] = SEMESTER_START.split('-').map(Number);
  const season = m >= 8 ? 'Fall' : m >= 5 ? 'Summer' : 'Spring';
  return `${season} ${y}`;
})();
// The upcoming term (for the Semester Plan Builder draft).
const NEXT_TERM = (() => {
  const [y] = SEMESTER_START.split('-').map(Number);
  if (TERM.startsWith('Fall')) return `Spring ${y + 1}`;
  if (TERM.startsWith('Spring')) return `Fall ${y}`;
  return `Fall ${y}`;
})();

// ----------------------------------------------------------------------------
// Small query helpers
// ----------------------------------------------------------------------------
/** INSERT/returning one row. */
async function one(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}
const J = (v) => JSON.stringify(v);
/** True if a table/relation exists (for feature-detected, unmerged-branch tables). */
async function tableExists(client, name) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name]);
  return rows[0]?.ok === true;
}
/** Distinct meeting weekdays from meeting_times, first-seen order (mirrors utils/meetingTimes). */
const meetingDaysFrom = (mts) => {
  const seen = new Set();
  const out = [];
  for (const mt of mts || []) if (mt?.day && !seen.has(mt.day)) { seen.add(mt.day); out.push(mt.day); }
  return out;
};
const earliestStart = (mts) => (mts || []).map((m) => m?.start).filter(Boolean).sort()[0] ?? null;

// ----------------------------------------------------------------------------
// Purge (scoped to the trial account) — mirrors the PR #77 cascade order.
// ----------------------------------------------------------------------------
async function purgeTrialUser(client, userId) {
  // These hold the user's rows via SET NULL / no FK, so CASCADE won't remove
  // them — delete explicitly first (same as accountDeletion.service.purgeUser).
  await client.query('DELETE FROM security_events WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM gate_events WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM audit_logs WHERE actor_user_id = $1 OR subject_student_id = $1', [userId]);
  // Everything else is ON DELETE CASCADE from users (or from classes, which
  // cascade from users): classes, assignments, grades, attendance, notes,
  // transcripts, decks/flashcards/reviews/mastery/streaks, podcasts, quizzes,
  // study_guides, mind_maps, activities/projects/tasks, plan_items,
  // draft_semester_plans/plan_sections, degree_programs/requirement_*, etc.
  await client.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ----------------------------------------------------------------------------
// User
// ----------------------------------------------------------------------------
async function createTrialUser(client) {
  const hash = await bcrypt.hash(PASSWORD, 12);
  // role 'demo' → full access to every premium Learn format (bypasses the paywall
  // like admins do), and the client's computed `premium` flag reads true. Matches
  // the existing demo seed's rationale.
  const user = await one(
    client,
    `INSERT INTO users
       (email, password_hash, full_name, school, timezone, role, plan,
        is_premium, subscription_tier, subscription_status, email_verified,
        graduation_credits)
     VALUES ($1,$2,$3,$4,$5,'demo','pro', true,'pro','active', true, 120)
     RETURNING id`,
    [EMAIL, hash, 'Trial Student', 'Loyola University Chicago (trial)', TIMEZONE],
  );
  return user.id;
}

// ----------------------------------------------------------------------------
// Classes
// ----------------------------------------------------------------------------
async function seedClasses(client, userId) {
  const defs = [
    {
      key: 'cs',
      name: 'Data Structures & Algorithms', code: 'COMP 271', color: COLORS.coral,
      instructor: 'Dr. Ada Okafor', instructorEmail: 'aokafor@luc.edu', location: 'Doyle Center 210',
      credits: 4,
      meetingTimes: [
        { day: 'Mon', start: '09:00', end: '09:50', location: 'Doyle Center 210' },
        { day: 'Wed', start: '09:00', end: '09:50', location: 'Doyle Center 210' },
        { day: 'Fri', start: '09:00', end: '09:50', location: 'Doyle Center 210' },
      ],
      // The one class with an explicit weighted grading scheme.
      gradingScheme: [
        { name: 'Homework', weight: 0.30 },
        { name: 'Exams', weight: 0.45 },
        { name: 'Project', weight: 0.25 },
      ],
      attendanceGraded: false,
    },
    {
      key: 'math',
      name: 'Calculus III', code: 'MATH 263', color: COLORS.sky,
      instructor: 'Prof. Nathan Reyes', instructorEmail: 'nreyes@luc.edu', location: 'Cudahy Science 118',
      credits: 4,
      meetingTimes: [
        { day: 'Tue', start: '13:00', end: '14:15', location: 'Cudahy Science 118' },
        { day: 'Thu', start: '13:00', end: '14:15', location: 'Cudahy Science 118' },
      ],
      gradingScheme: [],
      attendanceGraded: false,
    },
    {
      key: 'econ',
      name: 'Principles of Microeconomics', code: 'ECON 201', color: COLORS.teal,
      instructor: 'Dr. Priya Anand', instructorEmail: 'panand@luc.edu', location: 'Corboy Law 522',
      credits: 3,
      meetingTimes: [
        { day: 'Mon', start: '11:00', end: '11:50', location: 'Corboy Law 522' },
        { day: 'Wed', start: '11:00', end: '11:50', location: 'Corboy Law 522' },
        { day: 'Fri', start: '11:00', end: '11:50', location: 'Corboy Law 522' },
      ],
      gradingScheme: [],
      // Attendance counts toward the grade here → attendance % feeds the class grade.
      attendanceGraded: true, attendanceWeight: 10,
    },
    {
      key: 'phil',
      name: 'Symbolic Logic', code: 'PHIL 181', color: COLORS.hero,
      instructor: 'Dr. Marcus Feld', instructorEmail: 'mfeld@luc.edu', location: 'Crown Center 105',
      credits: 3,
      // Evening class.
      meetingTimes: [
        { day: 'Tue', start: '18:00', end: '20:30', location: 'Crown Center 105' },
      ],
      gradingScheme: [],
      attendanceGraded: true, attendanceWeight: 5,
    },
    {
      key: 'stat',
      name: 'Statistics for the Sciences (Online)', code: 'STAT 203', color: COLORS.sunset,
      instructor: 'Dr. Lena Hoffmann', instructorEmail: 'lhoffmann@luc.edu', location: 'Online — asynchronous',
      credits: 3,
      // ONLINE: no meeting times at all → exercises empty-schedule handling.
      meetingTimes: [],
      gradingScheme: [],
      attendanceGraded: false,
    },
    {
      key: 'biol',
      name: 'General Biology I', code: 'BIOL 115', color: COLORS.violet,
      instructor: 'Dr. Samuel Ortega', instructorEmail: 'sortega@luc.edu', location: 'Quinlan Life Sciences 340',
      credits: 4,
      // MWF lecture PLUS a Friday lab at a different time.
      meetingTimes: [
        { day: 'Mon', start: '10:00', end: '10:50', location: 'Quinlan Life Sciences 340' },
        { day: 'Wed', start: '10:00', end: '10:50', location: 'Quinlan Life Sciences 340' },
        { day: 'Fri', start: '10:00', end: '10:50', location: 'Quinlan Life Sciences 340' },
        { day: 'Fri', start: '14:00', end: '16:50', location: 'Quinlan Life Sciences 012 (Lab)' },
      ],
      gradingScheme: [],
      attendanceGraded: false,
    },
  ];

  const byKey = {};
  for (const c of defs) {
    const mDays = meetingDaysFrom(c.meetingTimes);
    const row = await one(
      client,
      `INSERT INTO classes
         (user_id, name, code, term, credits, color, instructor, instructor_email,
          location, meeting_times, meeting_days, meeting_time, grading_scheme,
          attendance_graded, attendance_weight, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17)
       RETURNING id`,
      [
        userId, c.name, c.code, TERM, c.credits, c.color, c.instructor, c.instructorEmail,
        c.location, J(c.meetingTimes), J(mDays), earliestStart(c.meetingTimes), J(c.gradingScheme),
        c.attendanceGraded, c.attendanceWeight ?? null, SEMESTER_START, SEMESTER_END,
      ],
    );
    byKey[c.key] = { id: row.id, ...c, meetingDays: mDays };
  }
  return byKey;
}

// ----------------------------------------------------------------------------
// Assignments (+ grades, submissions, files). ~50 rows, deliberately spread.
// ----------------------------------------------------------------------------
const STATUS_FOR = {
  not_started: { status: 'not_started', board: 'not_started', done: false },
  backlog: { status: 'not_started', board: 'backlog', done: false },
  planning: { status: 'not_started', board: 'planning', done: false },
  in_progress: { status: 'in_progress', board: 'in_progress', done: false },
  submitted: { status: 'submitted', board: 'done', done: true },
  graded: { status: 'graded', board: 'done', done: true },
};

async function insertAssignment(client, classId, a) {
  const st = STATUS_FOR[a.state];
  const dueDate = a.due == null ? null : day(a.due, 23, 59);
  const plannedDate = a.planned == null ? null : day(a.planned, 12, 0);
  const scheduled = a.sched == null ? null : day(a.sched, a.schedHour ?? 14, 0);
  const completedAt = st.done ? day(a.done ?? (a.due ?? -1), 16, 0) : null;
  const submittedAt = st.done ? completedAt : null;
  const row = await one(
    client,
    `INSERT INTO assignments
       (class_id, title, description, category, due_date, planned_date, scheduled_time,
        point_value, estimated_hours, priority, status, board_stage, completed_at,
        submitted_at, instructions, submission_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::assignment_status,$12::board_stage,$13,$14,$15,$16)
     RETURNING id`,
    [
      classId, a.title, a.description ?? null, a.category ?? null, dueDate, plannedDate, scheduled,
      a.points ?? null, a.hours ?? null, a.priority ?? 'none', st.status, st.board, completedAt,
      submittedAt, a.instructions ?? null, a.submissionText ?? null,
    ],
  );
  if (a.grade) {
    await client.query(
      `INSERT INTO grades (assignment_id, points_earned, points_possible, feedback, graded_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [row.id, a.grade[0], a.grade[1], a.gradeFeedback ?? null, day(a.done ?? a.due ?? -3, 10, 0)],
    );
  }
  return row.id;
}

async function seedAssignments(client, cls) {
  // Each entry: { due, planned?, sched?, state, points?, grade?, hours?, priority?, category? }
  // Offsets are days from today. Negative = past, 0 = today, positive = future.
  const plans = {
    cs: [
      { title: 'PS1 — Big-O & Arrays', category: 'Homework', due: -30, state: 'graded', points: 100, grade: [94, 100], hours: 2, priority: 'medium', gradeFeedback: 'Clean asymptotic analysis.' },
      { title: 'PS2 — Linked Lists', category: 'Homework', due: -20, state: 'graded', points: 100, grade: [88, 100], hours: 2.5, priority: 'medium' },
      { title: 'PS3 — Stacks & Queues', category: 'Homework', due: -6, state: 'submitted', points: 100, hours: 2 },
      { title: 'Midterm Exam', category: 'Exams', due: -9, state: 'graded', points: 100, grade: [82, 100], hours: 3, priority: 'high', gradeFeedback: 'Lost points on the heap question — review sift-down.' },
      { title: 'PS4 — Trees & Traversals', category: 'Homework', due: 0, state: 'in_progress', points: 100, hours: 2.5, priority: 'high', sched: 0, schedHour: 15, instructions: '<p>Implement <strong>in-order</strong>, pre-order, and post-order traversals. Include a short write-up comparing recursive vs. iterative approaches.</p><ul><li>Part A: BST insert/delete</li><li>Part B: traversal timing</li></ul>' },
      { title: 'PS5 — Hash Tables', category: 'Homework', due: 2, planned: 2, state: 'not_started', points: 100, hours: 2, priority: 'high' },
      { title: 'Course Project — Milestone 1 (proposal)', category: 'Project', due: 5, planned: 1, state: 'in_progress', points: 50, hours: 3, priority: 'medium', sched: 3, schedHour: 10 },
      { title: 'PS6 — Graphs (BFS/DFS)', category: 'Homework', due: 14, planned: 12, sched: 12, schedHour: 11, state: 'not_started', points: 100, hours: 3, priority: 'low' },
      { title: 'Final Project — Submission', category: 'Project', due: 44, planned: 40, state: 'not_started', points: 150, hours: 4 },
    ],
    math: [
      { title: 'WebAssign 5 — Partial Derivatives', due: -12, state: 'graded', points: 20, grade: [18, 20], hours: 1 },
      { title: 'WebAssign 6 — Multiple Integrals', due: -4, state: 'submitted', points: 20, hours: 1.5 },
      { title: 'Quiz 3', due: -2, state: 'not_started', points: 25, hours: 0.5, priority: 'high' }, // OVERDUE, not done
      { title: 'WebAssign 7 — Vector Fields', due: 0, state: 'not_started', points: 20, hours: 1, priority: 'high' }, // DUE TODAY
      { title: 'Problem Set — Green’s Theorem', due: 2, planned: 2, state: 'not_started', points: 40, hours: 2, priority: 'high' }, // overloaded day
      { title: 'Midterm 2', due: 9, planned: 6, state: 'not_started', points: 100, hours: 3, priority: 'medium', sched: 6, schedHour: 16 },
      { title: 'WebAssign 8 — Stokes', due: 18, sched: 16, schedHour: 15, state: 'not_started', points: 20, hours: 1 },
      { title: 'Final Exam', due: 47, state: 'not_started', points: 150 }, // no estimate on purpose
    ],
    econ: [
      { title: 'Reading Response 2', due: -16, state: 'graded', points: 15, grade: [15, 15], hours: 1 },
      { title: 'Problem Set 3 — Elasticity', due: -8, state: 'graded', points: 30, grade: [21, 30], hours: 1.5, priority: 'low', gradeFeedback: 'Mind the cross-price sign.' },
      { title: 'Problem Set 4 — Consumer Choice', due: -1, state: 'in_progress', points: 30, hours: 1.5, priority: 'high' }, // OVERDUE, in progress
      { title: 'Midterm', due: 3, planned: 1, state: 'not_started', points: 100, hours: 2.5, priority: 'medium', sched: 4, schedHour: 13 },
      { title: 'Discussion Post — Market Failures', due: 2, planned: 2, state: 'not_started', points: 10, hours: 1.5, priority: 'medium' }, // overloaded day
      { title: 'Problem Set 5 — Production Costs', due: 12, sched: 11, schedHour: 13, state: 'not_started', points: 30, hours: 1.5 },
      { title: 'Term Paper — Draft', due: 24, planned: 18, state: 'backlog', points: 60, hours: 3, priority: 'low' },
      { title: 'Term Paper — Final', due: 40, planned: 34, state: 'backlog', points: 100, hours: 4 },
    ],
    phil: [
      { title: 'Truth Tables Worksheet', due: -18, state: 'graded', points: 20, grade: [20, 20], hours: 1 },
      { title: 'Proofs Set 1', due: -11, state: 'graded', points: 25, grade: [19, 25], hours: 1.5 },
      { title: 'Proofs Set 2', due: -3, state: 'submitted', points: 25, hours: 1.5 }, // done late-ish
      { title: 'Quiz — Propositional Logic', due: -5, state: 'not_started', points: 20, hours: 0.5, priority: 'medium' }, // OVERDUE missed
      { title: 'Proofs Set 3 — Quantifiers', due: 2, planned: 2, state: 'not_started', points: 25, hours: 1.5, priority: 'high' }, // overloaded day
      { title: 'Midterm', due: 8, planned: 5, state: 'not_started', points: 100, hours: 2.5, sched: 5, schedHour: 19 },
      { title: 'Final Paper — Formal Systems', due: 38, planned: 30, state: 'planning', points: 100, hours: 4, priority: 'low' },
    ],
    stat: [
      { title: 'Module 3 Quiz', due: -14, state: 'graded', points: 20, grade: [17, 20], hours: 0.5 },
      { title: 'Lab 4 — Sampling Distributions', due: -7, state: 'graded', points: 30, grade: [27, 30], hours: 1.5 },
      { title: 'Module 5 Quiz', due: -3, state: 'not_started', points: 20, hours: 0.5, priority: 'medium' }, // OVERDUE
      { title: 'Lab 5 — Confidence Intervals', due: 0, state: 'not_started', points: 30, hours: 1.5, priority: 'high' }, // DUE TODAY
      { title: 'Discussion — Reading Data Viz', due: 6, planned: 4, state: 'not_started', points: 10, hours: 1 },
      { title: 'Midterm Project — Dataset Pitch', due: 15, planned: 10, state: 'not_started', points: 60, hours: 3, priority: 'low' },
      { title: 'Final Exam (proctored)', due: 46, state: 'not_started', points: 120 },
    ],
    biol: [
      { title: 'Pre-Lab 3', due: -22, state: 'graded', points: 10, grade: [9, 10], hours: 0.5 },
      { title: 'Lab Report 3 — Osmosis', due: -13, state: 'graded', points: 40, grade: [31, 40], hours: 2, priority: 'low', gradeFeedback: 'Graphs need axis labels + error bars.' },
      { title: 'Exam 1', due: -10, state: 'graded', points: 100, grade: [86, 100], hours: 3, priority: 'high' },
      { title: 'Lab Report 4 — Enzymes', due: -1, state: 'in_progress', points: 40, hours: 2, priority: 'high' }, // OVERDUE
      { title: 'Pre-Lab 5', due: 1, planned: 1, state: 'not_started', points: 10, hours: 0.5 },
      { title: 'Reading Quiz — Cellular Respiration', due: 4, state: 'not_started', points: 15, hours: 0.5, priority: 'medium' },
      { title: 'Exam 2', due: 11, planned: 7, state: 'not_started', points: 100, hours: 3, priority: 'medium', sched: 7, schedHour: 17 },
      { title: 'Lab Report 5 — Photosynthesis', due: 20, planned: 15, sched: 15, schedHour: 15, state: 'not_started', points: 40, hours: 2 },
      { title: 'Final Exam', due: 48, state: 'not_started', points: 150 },
    ],
  };

  const ids = {};
  for (const [key, list] of Object.entries(plans)) {
    ids[key] = [];
    for (const a of list) ids[key].push(await insertAssignment(client, cls[key].id, a));
  }
  return { ids, plans };
}

// A submission history + one attached file, on a couple of already-submitted items.
async function seedSubmissionsAndFiles(client, userId, cls, asg) {
  // COMP 271 PS3 (submitted) — a working-tab snapshot + an uploaded file.
  const ps3 = asg.ids.cs[2];
  const file = await one(
    client,
    `INSERT INTO class_files (class_id, user_id, assignment_id, filename, mime_type, category, size_bytes, data)
     VALUES ($1,$2,$3,$4,$5,'submission',$6,$7) RETURNING id`,
    [cls.cs.id, userId, ps3, 'ps3-stacks-queues.txt', 'text/plain', 42,
     Buffer.from('PS3 — Stacks & Queues\nSubmitted work placeholder.\n').toString('base64')],
  );
  await client.query('UPDATE assignments SET submission_file_id = $1 WHERE id = $2', [file.id, ps3]);
  await client.query(
    `INSERT INTO assignment_submissions (assignment_id, kind, file_id, created_at)
     VALUES ($1,'file',$2,$3)`, [ps3, file.id, day(-6, 15, 0)],
  );
  await client.query(
    `INSERT INTO assignment_submissions (assignment_id, kind, text, created_at)
     VALUES ($1,'working',$2,$3)`,
    [ps3, '<p>Array-backed stack; circular-buffer queue. All tests green.</p>', day(-6, 15, 5)],
  );

  // MATH WebAssign 6 (submitted) — an external link submission.
  const wa6 = asg.ids.math[1];
  await client.query(
    `INSERT INTO assignment_submissions (assignment_id, kind, url, created_at)
     VALUES ($1,'link',$2,$3)`,
    [wa6, 'https://webassign.example.edu/submissions/263-wa6', day(-4, 20, 0)],
  );

  // A class-level syllabus file on COMP 271 (exercises the Files tab).
  await client.query(
    `INSERT INTO class_files (class_id, user_id, filename, mime_type, category, size_bytes, data)
     VALUES ($1,$2,$3,$4,'syllabus',$5,$6)`,
    [cls.cs.id, userId, 'COMP271-syllabus.txt', 'text/plain', 60,
     Buffer.from('COMP 271 — Data Structures & Algorithms\nSyllabus placeholder for the trial account.\n').toString('base64')],
  );
}

// ----------------------------------------------------------------------------
// Attendance — mark a realistic present/late/absent/excused mix across the
// sessions that have already happened (start_date … today).
// ----------------------------------------------------------------------------
async function seedAttendance(client, cls) {
  // status by index cycle; excused/absent sprinkled so the % is non-trivial.
  const pattern = ['present', 'present', 'late', 'present', 'absent', 'present', 'present', 'excused', 'present', 'late', 'present', 'absent'];
  for (const key of Object.keys(cls)) {
    const c = cls[key];
    if (!c.meetingDays.length) continue; // online class: no sessions
    const dates = generateSessionDates(SEMESTER_START, SEMESTER_END, c.meetingDays)
      .filter((d) => d <= ymd(TODAY)); // only past/today sessions get marked
    let i = 0;
    for (const d of dates) {
      const status = pattern[i % pattern.length];
      i += 1;
      await client.query(
        `INSERT INTO attendance (class_id, session_date, status)
         VALUES ($1,$2,$3::attendance_status)
         ON CONFLICT (class_id, session_date) DO NOTHING`,
        [c.id, d, status],
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Notes — 4-5 on the major classes: one long w/ headings, one with LaTeX, one short.
// ----------------------------------------------------------------------------
async function seedNotes(client, userId, cls) {
  const notes = [
    { classId: cls.cs.id, title: 'Big-O cheat sheet', content: '# Big-O quick reference\n\n## Common orders\n- **O(1)** — hash lookup, array index\n- **O(log n)** — binary search, balanced-tree ops\n- **O(n)** — linear scan\n- **O(n log n)** — mergesort, heapsort\n- **O(n^2)** — nested loops, bubble sort\n\n## Data structures\n| Structure | Search | Insert | Delete |\n|-----------|--------|--------|--------|\n| Array | O(n) | O(n) | O(n) |\n| Hash table | O(1)* | O(1)* | O(1)* |\n| BST (balanced) | O(log n) | O(log n) | O(log n) |\n\n> \\* amortized / average case\n\n### Gotchas\n1. Hash tables degrade to O(n) with bad hashing.\n2. Recursion depth = O(h) stack space.' },
    { classId: cls.cs.id, title: 'Lecture 9 — heaps', content: 'Sift-up on insert, sift-down on extract-min. Array layout: parent = (i-1)/2, children = 2i+1, 2i+2. Build-heap is O(n), not O(n log n).' },
    { classId: cls.math.id, title: 'Green’s & Stokes’ theorems (LaTeX)', content: '## Green’s Theorem\n\nFor a positively oriented simple closed curve $C$ bounding region $D$:\n\n$$\\oint_C (P\\,dx + Q\\,dy) = \\iint_D \\left(\\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y}\\right)\\,dA$$\n\n## Stokes’ Theorem\n\n$$\\oint_C \\mathbf{F}\\cdot d\\mathbf{r} = \\iint_S (\\nabla \\times \\mathbf{F})\\cdot d\\mathbf{S}$$\n\nInline check: the curl $\\nabla \\times \\mathbf{F} = \\left(\\frac{\\partial R}{\\partial y}-\\frac{\\partial Q}{\\partial z}\\right)\\mathbf{i} + \\dots$' },
    { classId: cls.math.id, title: 'Jacobian reminder', content: 'Change of variables: $dA = \\left|\\frac{\\partial(x,y)}{\\partial(u,v)}\\right|\\,du\\,dv$. For polar: Jacobian $= r$.' },
    { classId: cls.biol.id, title: 'Cellular respiration — overview', content: '# Cellular respiration\n\n## Stages\n1. **Glycolysis** (cytoplasm) — glucose → 2 pyruvate, net 2 ATP + 2 NADH\n2. **Krebs cycle** (mitochondrial matrix) — 2 ATP, 6 NADH, 2 FADH2 per glucose\n3. **Electron transport chain** (inner membrane) — ~26-28 ATP via chemiosmosis\n\n## Key idea\nOxygen is the *final electron acceptor*. No O2 → fermentation.' },
    { classId: cls.econ.id, title: 'Elasticity — one-liner', content: 'PED = %ΔQd / %ΔP. |PED| > 1 elastic, < 1 inelastic. Total revenue rises when price moves toward the inelastic range.' },
  ];
  const noteIds = {};
  for (const n of notes) {
    const row = await one(
      client,
      `INSERT INTO notes (class_id, user_id, title, content) VALUES ($1,$2,$3,$4) RETURNING id`,
      [n.classId, userId, n.title, n.content],
    );
    noteIds[n.title] = row.id;
  }
  return noteIds;
}

// A lecture transcript with a stored AI summary (no API call — the output is
// seeded directly).
async function seedTranscript(client, userId, cls) {
  await client.query(
    `INSERT INTO transcripts (class_id, user_id, title, content, source, recorded_date, summary)
     VALUES ($1,$2,$3,$4,'paste',$5,$6)`,
    [
      cls.cs.id, userId, 'Lecture 9 — Heaps & Priority Queues',
      'Today we covered binary heaps. A heap is a complete binary tree stored in an array. For a min-heap, every parent is <= its children. Insert appends at the end and sifts up; extract-min swaps the root with the last element, removes it, and sifts down. Building a heap from an arbitrary array is O(n) using bottom-up heapify, which surprises most people since it looks like it should be O(n log n)...',
      dateOff(-8),
      '**Heaps — key points.** A binary heap is a complete tree in array form (parent i → children 2i+1, 2i+2). Insert = append + sift-up; extract-min = swap-root-with-last + sift-down. Bottom-up build-heap is O(n). Used for priority queues and heapsort.',
    ],
  );
}

// ----------------------------------------------------------------------------
// Learn — 3 flashcard decks at different SM-2 stages, plus streaks + stats.
// The current schedule lives on the flashcards row (next_review_date/repetitions/
// sm2_interval/ease_factor); mastery_levels caches new/learning/review/mastered;
// card_reviews is the append-only history that powers stats + streaks.
// ----------------------------------------------------------------------------
async function seedFlashcards(client, userId, cls) {
  const mkDeck = async (classId, name, description) =>
    (await one(client,
      `INSERT INTO decks (class_id, user_id, name, description) VALUES ($1,$2,$3,$4) RETURNING id`,
      [classId, userId, name, description])).id;

  // Insert a card at a given SM-2 stage and, if reviewed, its mastery row + review history.
  async function card(deckId, classId, q, a, stage, explanation = null) {
    // stage: 'new' | 'learning' | 'mature'
    let repetitions = 0, interval = 0, ease = 2.5, nextReview = null, reviews = [];
    if (stage === 'learning') {
      repetitions = 2; interval = 3; ease = 2.42; nextReview = day(1, 9, 0);
      reviews = [{ at: day(-3, 20), ivl: 1, ef: 2.5, rating: 3 }, { at: day(-2, 20), ivl: 3, ef: 2.42, rating: 3 }];
    } else if (stage === 'mature') {
      repetitions = 5; interval = 26; ease = 2.62; nextReview = day(20, 9, 0);
      reviews = [
        { at: day(-40, 20), ivl: 1, ef: 2.5, rating: 4 }, { at: day(-38, 20), ivl: 3, ef: 2.55, rating: 4 },
        { at: day(-33, 20), ivl: 8, ef: 2.58, rating: 4 }, { at: day(-24, 20), ivl: 16, ef: 2.60, rating: 3 },
        { at: day(-8, 20), ivl: 26, ef: 2.62, rating: 4 },
      ];
    }
    const c = await one(client,
      `INSERT INTO flashcards
         (class_id, user_id, deck_id, question, answer, explanation, generated_by,
          ease_factor, sm2_interval, repetitions, next_review_date)
       VALUES ($1,$2,$3,$4,$5,$6,'claude',$7,$8,$9,$10) RETURNING id`,
      [classId, userId, deckId, q, a, explanation, ease, interval, repetitions, nextReview]);

    if (stage !== 'new') {
      const correct = reviews.length;
      const status = repetitions >= 4 ? 'mastered' : repetitions >= 1 ? 'review' : 'learning';
      const pct = Math.round((correct / reviews.length) * 100);
      await client.query(
        `INSERT INTO mastery_levels
           (card_id, user_id, status, correct_count, total_reviews, confidence_average, mastery_percent)
         VALUES ($1,$2,$3::mastery_status,$4,$5,$6,$7)`,
        [c.id, userId, status, correct, reviews.length, 3.6, pct]);
      for (const r of reviews) {
        await client.query(
          `INSERT INTO card_reviews
             (user_id, card_id, reviewed_at, time_spent_seconds, confidence, correct,
              interval_days, ease_factor, next_review_at, phase)
           VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,'review')`,
          [userId, c.id, r.at, 12, r.rating, r.ivl, r.ef, nextReview]);
      }
    }
    return c.id;
  }

  // Deck A — brand new (no reviews). Progress bar at 0, all cards "New".
  const deckNew = await mkDeck(cls.biol.id, 'Cellular Respiration', 'Auto-generated from Lecture notes');
  await card(deckNew, cls.biol.id, 'Where does glycolysis occur?', 'The cytoplasm', 'new');
  await card(deckNew, cls.biol.id, 'Net ATP from glycolysis?', '2 ATP (and 2 NADH)', 'new');
  await card(deckNew, cls.biol.id, 'Final electron acceptor in aerobic respiration?', 'Oxygen', 'new');
  await card(deckNew, cls.biol.id, 'Where is the electron transport chain?', 'Inner mitochondrial membrane', 'new');

  // Deck B — in learning (1-3 reps; some due now/soon). Partial mastery.
  const deckLearn = await mkDeck(cls.cs.id, 'Heaps & Priority Queues', 'From Lecture 9 transcript');
  await card(deckLearn, cls.cs.id, 'Parent index of node i (0-based array heap)?', 'floor((i-1)/2)', 'learning', 'Children live at 2i+1 and 2i+2.');
  await card(deckLearn, cls.cs.id, 'Build-heap time complexity?', 'O(n) bottom-up', 'learning');
  await card(deckLearn, cls.cs.id, 'Extract-min: what happens to the root?', 'Swap with last element, remove it, sift down', 'learning');
  await card(deckLearn, cls.cs.id, 'Min-heap invariant?', 'Every parent <= its children', 'learning');

  // Deck C — mature/mastered (5 reps, long interval, high mastery).
  const deckMature = await mkDeck(cls.math.id, 'Vector Calculus Theorems', 'Core theorems — reviewed all term');
  await card(deckMature, cls.math.id, 'Green’s theorem relates a line integral to a…', 'double integral over the enclosed region', 'mature');
  await card(deckMature, cls.math.id, 'Polar Jacobian?', 'r', 'mature');
  await card(deckMature, cls.math.id, 'Stokes’ theorem generalizes which 2D theorem?', 'Green’s theorem', 'mature');

  // Streaks (global + per class) and the aggregate stats row the dashboard reads.
  await client.query(
    `INSERT INTO learning_streaks (user_id, class_id, current_streak, longest_streak, last_reviewed_at, reviews_today)
     VALUES ($1, NULL, 6, 11, $2, 3)`, [userId, dateOff(-1)]);
  await client.query(
    `INSERT INTO learning_streaks (user_id, class_id, current_streak, longest_streak, last_reviewed_at, reviews_today)
     VALUES ($1, $2, 4, 9, $3, 2)`, [userId, cls.cs.id, dateOff(-1)]);
  await client.query(
    `INSERT INTO user_learning_stats
       (user_id, total_cards, mastered_cards, learning_cards, new_cards, global_streak,
        longest_global_streak, total_study_hours, average_session_minutes,
        average_mastery_percent, retention_rate, level, experience_points)
     VALUES ($1, 11, 3, 4, 4, 6, 11, 9.5, 18, 62, 0.86, 3, 640)`, [userId]);
}

// One podcast + one AI study guide + a quiz w/ attempt + a mind map — all stored
// outputs seeded directly (NO paid API calls in the seeder).
async function seedLearnArtifacts(client, userId, cls) {
  await client.query(
    `INSERT INTO podcasts (class_id, user_id, title, description, transcript_text, duration_seconds, generated_from, completion_percent, listened_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cls.cs.id, userId, 'Heaps in 6 minutes', 'A two-host walkthrough of binary heaps and priority queues.',
     'HOST A: So today we’re tackling heaps. HOST B: Right, and the big "aha" is that a heap is just an array pretending to be a tree. HOST A: Exactly — parent at i, kids at 2i+1 and 2i+2 ...',
     372, ['note:Big-O cheat sheet', 'transcript:Lecture 9'], 100, day(-2, 21, 0)],
  );
  await client.query(
    `INSERT INTO study_guides (class_id, user_id, title, content, generated_from, bookmarked, read_at)
     VALUES ($1,$2,$3,$4,$5,true,$6)`,
    [cls.math.id, userId, 'Study guide — Vector Calculus',
     '# Vector Calculus — exam guide\n\n## Must-know theorems\n- **Green’s**: line integral ↔ double integral of the curl (2D)\n- **Stokes’**: generalizes Green’s to surfaces in 3D\n- **Divergence**: flux ↔ triple integral of divergence\n\n## Common mistakes\n1. Forgetting orientation (positive = counterclockwise).\n2. Dropping the Jacobian on change of variables.',
     ['note:Green’s & Stokes’ theorems'], day(-3, 19, 0)],
  );
  await client.query(
    `INSERT INTO quizzes (class_id, user_id, title, question_count, questions, attempted_at, score, time_spent_seconds)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
    [cls.biol.id, userId, 'Quiz — Cellular Respiration', 3,
     J([
       { type: 'mcq', prompt: 'Where does glycolysis occur?', options: ['Cytoplasm', 'Matrix', 'Inner membrane', 'Nucleus'], answer: 0 },
       { type: 'mcq', prompt: 'Final electron acceptor?', options: ['CO2', 'Water', 'Oxygen', 'NAD+'], answer: 2 },
       { type: 'tf', prompt: 'Build-up of ATP happens mainly in glycolysis.', answer: false },
     ]),
     day(-5, 20, 0), 67, 240],
  );
  await client.query(
    `INSERT INTO mind_maps (class_id, user_id, title, topic, nodes, edges, generated_from)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [cls.biol.id, userId, 'Respiration map', 'Cellular respiration',
     J([{ id: 'n1', label: 'Glucose' }, { id: 'n2', label: 'Glycolysis' }, { id: 'n3', label: 'Krebs' }, { id: 'n4', label: 'ETC' }]),
     J([{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }]),
     ['note:Cellular respiration']],
  );
}

// ----------------------------------------------------------------------------
// Activities — 2 activities, each with projects (varied stages) + tasks; one
// project sits at 3/4 done (near auto-complete).
// ----------------------------------------------------------------------------
async function seedActivities(client, userId) {
  const mkActivity = async (name, kind, color, stage, description) =>
    (await one(client,
      `INSERT INTO activities (user_id, name, kind, color, stage, description) VALUES ($1,$2,$3,$4,$5::activity_stage,$6) RETURNING id`,
      [userId, name, kind, color, stage, description])).id;
  const mkProject = async (activityId, name, stage, sort) =>
    (await one(client,
      `INSERT INTO activity_projects (activity_id, name, stage, sort_order, completed_at)
       VALUES ($1,$2,$3::activity_stage,$4,$5) RETURNING id`,
      [activityId, name, stage, sort, stage === 'done' ? day(-2, 12) : null])).id;
  const mkTask = async (projectId, title, { due = null, done = false, sort = 0 } = {}) =>
    client.query(
      `INSERT INTO activity_tasks (project_id, title, due_date, completed_at, board_stage, sort_order)
       VALUES ($1,$2,$3,$4,$5::board_stage,$6)`,
      [projectId, title, due == null ? null : day(due, 17), done ? day(due ?? -1, 15) : null, done ? 'done' : 'not_started', sort],
    );

  // Activity 1 — Robotics Club (in progress).
  const robotics = await mkActivity('Robotics Club', 'club', COLORS.teal, 'in_progress', 'VEX-U competition team — build + outreach.');
  const bot = await mkProject(robotics, 'Competition bot v2', 'in_progress', 0);
  // 3 of 4 done → near auto-complete.
  await mkTask(bot, 'Redesign drivetrain', { due: -10, done: true, sort: 0 });
  await mkTask(bot, 'Wire the sensor array', { due: -4, done: true, sort: 1 });
  await mkTask(bot, 'Tune autonomous routine', { due: -1, done: true, sort: 2 });
  await mkTask(bot, 'Field-test at scrimmage', { due: 5, done: false, sort: 3 });
  const outreach = await mkProject(robotics, 'STEM outreach day', 'backlog', 1);
  await mkTask(outreach, 'Book the venue', { due: 20, done: false, sort: 0 });
  await mkTask(outreach, 'Recruit volunteers', { due: 25, done: false, sort: 1 });
  const grant = await mkProject(robotics, 'Spring grant application', 'done', 2);
  await mkTask(grant, 'Draft budget', { due: -14, done: true, sort: 0 });
  await mkTask(grant, 'Submit application', { due: -8, done: true, sort: 1 });

  // Activity 2 — Freelance web design (in progress).
  const freelance = await mkActivity('Freelance Web Design', 'freelance', COLORS.hero, 'in_progress', 'Side income — small business sites.');
  const clientSite = await mkProject(freelance, 'Bakery site — client A', 'active', 0);
  await mkTask(clientSite, 'Gather brand assets', { due: -6, done: true, sort: 0 });
  await mkTask(clientSite, 'Build landing page', { due: 3, done: false, sort: 1 });
  await mkTask(clientSite, 'Set up contact form', { due: 8, done: false, sort: 2 });
  const portfolio = await mkProject(freelance, 'Portfolio revamp', 'in_progress', 1);
  await mkTask(portfolio, 'Write case studies', { due: 12, done: false, sort: 0 });
}

// ----------------------------------------------------------------------------
// Planner roadmap (plan_items) — partially filled so requirements-aware auto-fill
// has work, with one deliberately invalid placement (a course sitting BEFORE its
// prerequisite) so a blocking message can be demonstrated.
// ----------------------------------------------------------------------------
async function seedRoadmap(client, userId, cls) {
  const [sy] = SEMESTER_START.split('-').map(Number);
  const curYear = sy;
  const items = [
    // Past (completed) — freshman/sophomore
    { year: curYear - 1, season: 'Fall', name: 'Intro to Data Science', code: 'DATA 118', credits: 3, status: 'completed' },
    { year: curYear - 1, season: 'Fall', name: 'Calculus I', code: 'MATH 161', credits: 4, status: 'completed' },
    { year: curYear - 1, season: 'Spring', name: 'Calculus II', code: 'MATH 162', credits: 4, status: 'completed' },
    { year: curYear - 1, season: 'Spring', name: 'Data Structures Prep', code: 'DATA 161', credits: 3, status: 'completed' },
    // Current term — in progress (mirrors the dashboard classes conceptually)
    { year: curYear, season: 'Fall', name: 'Calculus III', code: 'MATH 263', credits: 4, status: 'in_progress' },
    { year: curYear, season: 'Fall', name: 'Data Structures & Algorithms', code: 'COMP 271', credits: 4, status: 'in_progress' },
    { year: curYear, season: 'Fall', name: 'Statistics for the Sciences', code: 'STAT 203', credits: 3, status: 'in_progress' },
    // Next term — partially planned (leaves room for auto-fill)
    { year: curYear + 1, season: 'Spring', name: 'Linear Algebra', code: 'MATH 212', credits: 3, status: 'planned' },
    // INVALID on purpose: DATA 212 requires DATA 162, which is NOT planned before
    // this term — placing it here should trip the roadmap's blocking message.
    { year: curYear + 1, season: 'Spring', name: 'Machine Learning', code: 'DATA 212', credits: 3, status: 'planned' },
  ];
  for (const it of items) {
    await client.query(
      `INSERT INTO plan_items (user_id, year, season, name, code, credits, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::plan_status)`,
      [userId, it.year, it.season, it.name, it.code, it.credits, it.status],
    );
  }
}

// ----------------------------------------------------------------------------
// Degree Requirements (R-features) — FEATURE-DETECTED. Tables live on
// feat/degree-requirements; seeded only when present. A Data-Science-like
// program with a prereq chain (incl. an OR-group + a summer-only course), a
// pick-3-of-8 electives tray, and a no-course-list category.
// ----------------------------------------------------------------------------
async function seedDegreeRequirements(client, userId) {
  if (!(await tableExists(client, 'degree_programs'))) {
    console.log('  · Degree Requirements tables not found (feat/degree-requirements not merged) — skipped.');
    return false;
  }
  const prog = await one(client,
    `INSERT INTO degree_programs (user_id, name, total_credits) VALUES ($1,$2,$3) RETURNING id`,
    [userId, 'B.S. Data Science', 120]);

  const mkCat = async (name, credits, notes, position) =>
    (await one(client,
      `INSERT INTO requirement_categories (program_id, name, credits_required, notes, position)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [prog.id, name, credits, notes, position])).id;
  const mkCourse = async (categoryId, code, title, credits, offeredTerms, prereqGroups, position) =>
    client.query(
      `INSERT INTO requirement_courses (category_id, course_code, course_title, credits, offered_terms, prereq_groups, position)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [categoryId, code, title, credits, offeredTerms == null ? null : J(offeredTerms), J(prereqGroups), position]);

  // 1) Core — the 4-course prereq CHAIN 118 → 161 → 162 → 212, with an OR-group
  //    on 161 (DATA 118 AND (MATH 161 OR PLACEMENT)) and a SUMMER-ONLY course
  //    mid-chain (DATA 162).
  const core = await mkCat('Core Data Science', 24, null, 0);
  await mkCourse(core, 'DATA 118', 'Introduction to Data Science', 3, ['Fall', 'Spring'], [], 0);
  await mkCourse(core, 'DATA 161', 'Data Structures for DS', 3, ['Fall', 'Spring'], [['DATA 118'], ['MATH 161', 'PLACEMENT']], 1);
  await mkCourse(core, 'DATA 162', 'Algorithms for DS (summer only)', 3, ['Summer'], [['DATA 161']], 2);
  await mkCourse(core, 'DATA 212', 'Machine Learning', 3, ['Fall', 'Spring'], [['DATA 162']], 3);
  await mkCourse(core, 'COMP 271', 'Data Structures & Algorithms', 4, ['Fall', 'Spring'], [['DATA 118']], 4);
  await mkCourse(core, 'DATA 310', 'Data Engineering', 3, ['Fall'], [['DATA 212']], 5);

  // 2) Mathematics — chain feeders.
  const math = await mkCat('Mathematics', 15, null, 1);
  await mkCourse(math, 'MATH 161', 'Calculus I', 4, ['Fall', 'Spring'], [], 0);
  await mkCourse(math, 'MATH 162', 'Calculus II', 4, ['Fall', 'Spring'], [['MATH 161', 'PLACEMENT']], 1);
  await mkCourse(math, 'MATH 263', 'Calculus III', 4, ['Fall', 'Spring'], [['MATH 162']], 2);
  await mkCourse(math, 'MATH 212', 'Linear Algebra', 3, ['Fall', 'Spring'], [['MATH 162']], 3);

  // 3) Statistics.
  const stats = await mkCat('Statistics & Methods', 9, null, 2);
  await mkCourse(stats, 'STAT 203', 'Statistics for the Sciences', 3, ['Fall', 'Spring', 'Summer'], [['MATH 162']], 0);
  await mkCourse(stats, 'STAT 308', 'Statistical Modeling', 3, ['Spring'], [['STAT 203']], 1);
  await mkCourse(stats, 'STAT 335', 'Bayesian Methods', 3, ['Fall'], [['STAT 308']], 2);

  // 4) Electives — PICK 3 OF 8 (exercises the R3 "You choose" tray).
  const elec = await mkCat('DS Electives', 9, 'Choose any 3 of the following.', 3);
  const electives = [
    ['DATA 320', 'Natural Language Processing'], ['DATA 322', 'Computer Vision'],
    ['DATA 330', 'Data Visualization'], ['DATA 340', 'Time Series'],
    ['DATA 350', 'Deep Learning'], ['DATA 360', 'Cloud & Big Data'],
    ['DATA 370', 'Ethics of AI'], ['DATA 380', 'Reinforcement Learning'],
  ];
  let p = 0;
  for (const [code, title] of electives) await mkCourse(elec, code, title, 3, null, [['DATA 212']], p++);

  // 5) NO course list — a prose-only category ("9 credits any 300-level").
  await mkCat('General Education — Upper Division', 9, '9 credits from any 300-level course outside the major. No specific course list.', 4);

  // Completed / transferred / AP (satisfy prereqs + count toward categories).
  const completed = [
    ['DATA 118', 'Introduction to Data Science', 3, 'completed'],
    ['MATH 161', 'Calculus I', 4, 'transferred'],
    ['MATH 162', 'Calculus II', 4, 'completed'],
    ['ENGL 101', 'College Writing', 3, 'ap'],
  ];
  for (const [code, title, credits, source] of completed) {
    await client.query(
      `INSERT INTO completed_courses (user_id, course_code, course_title, credits, source)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, course_code) DO NOTHING`,
      [userId, code, title, credits, source]);
  }
  // A non-course prereq token satisfied out of band → satisfies the OR-group.
  await client.query(
    `INSERT INTO met_prereqs (user_id, token) VALUES ($1,'PLACEMENT') ON CONFLICT (user_id, token) DO NOTHING`,
    [userId]);
  return true;
}

// ----------------------------------------------------------------------------
// Semester Plan Builder — a DRAFT plan with ~5 courses × 3-4 sections. Includes
// engineered conflicts (a course whose every section collides with another
// course's every section), varied professors, and one section missing times.
// ----------------------------------------------------------------------------
async function seedSemesterPlanDraft(client, userId) {
  const plan = await one(client,
    `INSERT INTO draft_semester_plans (user_id, term) VALUES ($1,$2) RETURNING id`,
    [userId, NEXT_TERM]);

  const S = (course, title, section, days, start, end, prof, loc) => ({
    course, title, section, days, start, end, prof, loc,
  });
  const sections = [
    // MATH 212 — 3 sections, varied times/professors.
    S('MATH 212', 'Linear Algebra', '001', ['Mon', 'Wed', 'Fri'], '09:00', '09:50', 'Prof. Reyes', 'Cudahy 118'),
    S('MATH 212', 'Linear Algebra', '002', ['Tue', 'Thu'], '11:00', '12:15', 'Dr. Ivanova', 'Cudahy 210'),
    S('MATH 212', 'Linear Algebra', '003', ['Mon', 'Wed', 'Fri'], '13:00', '13:50', 'Prof. Reyes', 'Cudahy 118'),

    // DATA 212 — 3 sections.
    S('DATA 212', 'Machine Learning', '001', ['Tue', 'Thu'], '14:30', '15:45', 'Dr. Okafor', 'Doyle 305'),
    S('DATA 212', 'Machine Learning', '002', ['Mon', 'Wed'], '15:00', '16:15', 'Dr. Okafor', 'Doyle 305'),
    S('DATA 212', 'Machine Learning', '003', ['Fri'], '10:00', '12:45', 'Dr. Bhatt', 'Doyle 120'),

    // STAT 308 — 3 sections.
    S('STAT 308', 'Statistical Modeling', '001', ['Mon', 'Wed', 'Fri'], '11:00', '11:50', 'Dr. Hoffmann', 'IES 104'),
    S('STAT 308', 'Statistical Modeling', '002', ['Tue', 'Thu'], '09:30', '10:45', 'Dr. Hoffmann', 'IES 104'),
    S('STAT 308', 'Statistical Modeling', '003', ['Tue', 'Thu'], '16:00', '17:15', 'Dr. Nwosu', 'IES 220'),

    // ---- ENGINEERED ZERO-RESULTS PAIR --------------------------------------
    // PHIL 201 and HIST 210 each offer ONLY sections in the exact same MWF
    // 10:00 slot, so pinning one of each can never resolve to a conflict-free
    // schedule → exercises the "no conflict-free combination" explanation.
    S('PHIL 201', 'Ethics', '001', ['Mon', 'Wed', 'Fri'], '10:00', '10:50', 'Dr. Feld', 'Crown 105'),
    S('PHIL 201', 'Ethics', '002', ['Mon', 'Wed', 'Fri'], '10:00', '10:50', 'Dr. Feld', 'Crown 107'),
    S('HIST 210', 'Modern Europe', '001', ['Mon', 'Wed', 'Fri'], '10:00', '10:50', 'Dr. Salib', 'Crown 210'),
    S('HIST 210', 'Modern Europe', '002', ['Mon', 'Wed', 'Fri'], '10:00', '10:50', 'Dr. Salib', 'Crown 212'),
  ];

  let i = 0;
  for (const s of sections) {
    await client.query(
      `INSERT INTO plan_sections
         (plan_id, course_code, course_title, section_number, days, start_time, end_time, professor, location, term)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [plan.id, s.course, s.title, s.section, J(s.days), s.start, s.end, s.prof, s.loc, NEXT_TERM],
    );
    i++;
  }
  // One section MISSING TIMES (days empty, no start/end) → unschedulable flag.
  await client.query(
    `INSERT INTO plan_sections
       (plan_id, course_code, course_title, section_number, days, start_time, end_time, professor, location, term)
     VALUES ($1,'DATA 212','Machine Learning','004','[]'::jsonb, NULL, NULL, 'Staff', 'TBA', $2)`,
    [plan.id, NEXT_TERM],
  );
  return i + 1;
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------
async function main() {
  if (looksLikeProd() && !YES_PROD) {
    console.error(
      'Refusing to run: DATABASE_URL looks production-like (remote host or NODE_ENV=production).\n' +
      'This seeder only ever touches the single trial account, but re-run with --yes-i-mean-it to proceed.',
    );
    process.exitCode = 1;
    return;
  }

  // Does the account already exist / already have data?
  const existing = (await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL])).rows[0];
  if (existing && !RESET) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM classes WHERE user_id = $1', [existing.id]);
    if (rows[0].n > 0) {
      console.log(
        `Trial account ${EMAIL} already seeded (${rows[0].n} classes). ` +
        'Re-run with --reset to wipe and rebuild.',
      );
      return;
    }
  }

  await withTransaction(async (client) => {
    if (existing) {
      console.log(`${RESET ? 'Resetting' : 'Rebuilding'} trial account ${EMAIL} …`);
      await purgeTrialUser(client, existing.id);
    } else {
      console.log(`Creating trial account ${EMAIL} …`);
    }

    const userId = await createTrialUser(client);
    const cls = await seedClasses(client, userId);
    const asg = await seedAssignments(client, cls);
    await seedSubmissionsAndFiles(client, userId, cls, asg);
    await seedAttendance(client, cls);
    await seedNotes(client, userId, cls);
    await seedTranscript(client, userId, cls);
    await seedFlashcards(client, userId, cls);
    await seedLearnArtifacts(client, userId, cls);
    await seedActivities(client, userId);
    await seedRoadmap(client, userId, cls);
    const seededReqs = await seedDegreeRequirements(client, userId);
    const sectionCount = await seedSemesterPlanDraft(client, userId);

    const asgCount = Object.values(asg.plans).reduce((s, l) => s + l.length, 0);
    console.log('\nSeeded the trial semester:');
    console.log(`  email        ${EMAIL}`);
    console.log(`  password     ${PASSWORD}`);
    console.log(`  term         ${TERM}  (${SEMESTER_START} → ${SEMESTER_END}, anchored on ${ymd(TODAY)})`);
    console.log(`  classes      ${Object.keys(cls).length}`);
    console.log(`  assignments  ${asgCount}`);
    console.log(`  activities   2 (with projects + tasks)`);
    console.log(`  learn        3 decks (new/learning/mature) + podcast + guide + quiz + mind map`);
    console.log(`  requirements ${seededReqs ? 'seeded (B.S. Data Science)' : 'skipped (tables absent)'}`);
    console.log(`  plan builder ${sectionCount} draft sections for ${NEXT_TERM}`);
  });
}

main()
  .catch((err) => {
    console.error('\nTrial seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
