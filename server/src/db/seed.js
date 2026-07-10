/**
 * Seed a demo student with one class, a couple of assignments, and a grade so
 * the API has something to return during development. Safe to re-run: it upserts
 * the demo user by email and skips if data already exists.
 */
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';

const DEMO_EMAIL = 'demo@student.app';

async function main() {
  // Refuse to seed a production database. Seeding overwrites the demo user and
  // creates a known-credential demo account, so running it against the live DB
  // is destructive. Require an explicit ALLOW_PROD_SEED=true to override.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    console.error(
      'Refusing to seed: NODE_ENV=production. Set ALLOW_PROD_SEED=true to override.',
    );
    process.exitCode = 1;
    return;
  }

  await withTransaction(async (client) => {
    const passwordHash = await bcrypt.hash('password123', 12);

    // The demo account is role 'demo' so it has full access to premium Learn
    // features (the showcase account bypasses the paywall, like admins do).
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, school, role)
       VALUES ($1, $2, $3, $4, 'demo')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'demo'
       RETURNING id`,
      [DEMO_EMAIL, passwordHash, 'Demo Student', 'Example University'],
    );
    const userId = userRows[0].id;

    // Only seed class data once for the demo user.
    const { rowCount } = await client.query(
      'SELECT 1 FROM classes WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    if (rowCount > 0) {
      console.log('Demo data already present; skipping class/assignment seed.');
      return;
    }

    const { rows: classRows } = await client.query(
      `INSERT INTO classes
         (user_id, name, code, term, credits, color, instructor, grading_scheme)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        userId,
        'Introduction to Computer Science',
        'CS 101',
        'Fall 2026',
        4,
        '#4F46E5',
        'Dr. Ada Lovelace',
        JSON.stringify([
          { name: 'Homework', weight: 0.3 },
          { name: 'Exams', weight: 0.5 },
          { name: 'Final', weight: 0.2 },
        ]),
      ],
    );
    const classId = classRows[0].id;

    const { rows: assignmentRows } = await client.query(
      `INSERT INTO assignments
         (class_id, title, category, due_date, planned_date, point_value, status)
       VALUES
         ($1, 'Problem Set 1', 'Homework', now() + interval '7 days',
          now() + interval '5 days', 100, 'not_started'),
         ($1, 'Midterm Exam', 'Exams', now() + interval '21 days',
          now() + interval '18 days', 100, 'not_started')
       RETURNING id`,
      [classId],
    );

    // Give the first assignment a grade so roll-up logic has data to chew on.
    await client.query(
      `INSERT INTO grades (assignment_id, points_earned, points_possible)
       VALUES ($1, $2, $3)`,
      [assignmentRows[0].id, 92, 100],
    );

    console.log('Seeded demo student.');
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
