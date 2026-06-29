-- ============================================================================
-- Student Workflow App — PostgreSQL schema
-- ----------------------------------------------------------------------------
-- Entities: users (students), classes, assignments, grades, archives.
-- Grades store raw scores; weighted GPA/grade roll-ups are computed in the app
-- using each class's grading_scheme.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto (PostgreSQL 13+ ships it in core, but the
-- extension guarantees availability on older managed instances).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- citext gives us a case-insensitive text type for emails.
CREATE EXTENSION IF NOT EXISTS "citext";

-- ----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- users (students)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,            -- case-insensitive unique email
  password_hash TEXT   NOT NULL,
  full_name     TEXT   NOT NULL,
  -- Optional academic context the dashboard can surface.
  school        TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- refresh_tokens — server-side record of issued refresh tokens (rotation +
-- revocation). Access tokens stay stateless JWTs; refresh tokens are tracked.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,                -- SHA-256 of the raw token
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- ----------------------------------------------------------------------------
-- classes — a course a student is taking in a given term, plus syllabus data.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                   -- "Introduction to Computer Science"
  description     TEXT,                            -- free-text notes / course description
  code            TEXT,                            -- "CS 101"
  term            TEXT,                            -- "Fall 2026" — groups a semester (optional)
  credits         NUMERIC(4,2),
  color           TEXT,                            -- hex for UI, e.g. "#4F46E5"

  -- Syllabus data ----------------------------------------------------------
  instructor       TEXT,
  instructor_email TEXT,
  location         TEXT,
  -- Recurring meeting times, e.g.
  --   [{"day":"MON","start":"10:00","end":"10:50","location":"Bldg 4"}]
  meeting_times    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Weighted grading categories that drive auto-calculation, e.g.
  --   [{"name":"Homework","weight":0.30},{"name":"Exams","weight":0.50},
  --    {"name":"Final","weight":0.20}]  -- weights should sum to 1.0
  grading_scheme   JSONB NOT NULL DEFAULT '[]'::jsonb,
  syllabus_url     TEXT,

  start_date      DATE,
  end_date        DATE,
  archived_at     TIMESTAMPTZ,                     -- null = active

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For databases created before term became optional / description was added.
ALTER TABLE classes ALTER COLUMN term DROP NOT NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_classes_user_id ON classes(user_id);
CREATE INDEX IF NOT EXISTS idx_classes_user_term ON classes(user_id, term);
-- Quickly separate active vs. archived classes.
CREATE INDEX IF NOT EXISTS idx_classes_user_archived ON classes(user_id, archived_at);

DROP TRIGGER IF EXISTS trg_classes_updated_at ON classes;
CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- assignments — work items within a class.
--   due_date     = official deadline
--   planned_date = when the student intends to do the work (for scheduling)
--   category     = ties an assignment to a grading_scheme bucket
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE assignment_status AS ENUM
      ('not_started', 'in_progress', 'submitted', 'graded');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT,                               -- matches grading_scheme[].name
  due_date     TIMESTAMPTZ,
  planned_date TIMESTAMPTZ,
  point_value  NUMERIC(8,2),                       -- points the assignment is worth
  status       assignment_status NOT NULL DEFAULT 'not_started',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON assignments;
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- grades — one score per assignment. points_possible is denormalized from the
-- assignment at grading time so historical grades stay stable if the
-- assignment's point_value is later edited.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
  points_earned   NUMERIC(8,2) NOT NULL,
  points_possible NUMERIC(8,2) NOT NULL CHECK (points_possible > 0),
  feedback        TEXT,
  graded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grades_assignment_id ON grades(assignment_id);

DROP TRIGGER IF EXISTS trg_grades_updated_at ON grades;
CREATE TRIGGER trg_grades_updated_at
  BEFORE UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- archives — point-in-time snapshots (e.g. archiving a finished semester). The
-- snapshot column stores a self-contained JSON copy so the record survives even
-- if the source rows are deleted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archives (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,                      -- 'class' | 'term' | ...
  entity_id    UUID,                               -- source id, if still present
  label        TEXT,                               -- "Fall 2026", "CS 101"
  snapshot     JSONB NOT NULL,                     -- full copy of the archived data
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archives_user_id ON archives(user_id);
