-- ============================================================================
-- Summit — PostgreSQL schema
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

-- User settings (theme, color scheme, font size, default views, etc.).
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- How the user discovered Summit (signup attribution). One of a small enum set;
-- 'other' may carry a free-text detail in referral_source_detail.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_source_detail TEXT;

-- LMS integration (Canvas today; Blackboard/Brightspace/Moodle reuse the same
-- columns — see services/lms/). Tokens are stored ENCRYPTED (AES-256-GCM); the
-- app never persists them in plaintext. lms_domain is the per-institution host
-- (e.g. "asu.instructure.com").
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_provider          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_domain            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_access_token      TEXT;   -- encrypted
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_refresh_token     TEXT;   -- encrypted
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_token_expires_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_connected         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lms_synced_at         TIMESTAMPTZ;

-- Google Calendar one-way sync (Summit → Google). Tokens stored ENCRYPTED, same
-- as the LMS tokens. gcal_sync_enabled gates the push; gcal_synced_at records the
-- last successful run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_connected          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_access_token       TEXT;   -- encrypted
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_refresh_token      TEXT;   -- encrypted
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_token_expires_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_sync_enabled       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gcal_synced_at          TIMESTAMPTZ;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- gcal_events — maps a Summit assignment date to the Google Calendar event it
-- created, so syncs can UPDATE (not duplicate) and DELETE events when the
-- assignment is removed/completed. assignment_id is intentionally NOT a FK so a
-- deleted assignment leaves a tombstone the next sync can clean up remotely.
-- kind is 'due' or 'planned' (each maps to its own calendar event).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gcal_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL,
  kind          TEXT NOT NULL,            -- 'due' | 'planned'
  event_id      TEXT NOT NULL,            -- Google Calendar event id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, assignment_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_gcal_events_user_id ON gcal_events(user_id);

-- ----------------------------------------------------------------------------
-- lms_connections — one row per (user, LMS provider) the student has linked.
--
-- The original Canvas integration stored a single connection in the users.lms_*
-- columns above. To let a student connect MORE THAN ONE LMS at once (e.g. some
-- classes in Canvas, others in Blackboard) every connection now lives here,
-- keyed by provider. `domain` is the per-institution host / instance URL
-- (NULL for single-tenant providers like Google Classroom). Tokens are stored
-- ENCRYPTED (AES-256-GCM) exactly as before — never in plaintext.
--
-- The users.lms_* columns are kept for backward compatibility and are backfilled
-- into this table below; the app reads/writes lms_connections going forward.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,              -- 'canvas' | 'blackboard' | 'google_classroom' | ...
  domain           TEXT,                       -- institution host / instance URL (NULL if single-tenant)
  access_token     TEXT,                       -- encrypted
  refresh_token    TEXT,                       -- encrypted
  token_expires_at TIMESTAMPTZ,
  connected        BOOLEAN NOT NULL DEFAULT false,
  synced_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_lms_connections_user_id ON lms_connections(user_id);

DROP TRIGGER IF EXISTS trg_lms_connections_updated_at ON lms_connections;
CREATE TRIGGER trg_lms_connections_updated_at
  BEFORE UPDATE ON lms_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: migrate any existing single-connection (Canvas) link from the legacy
-- users.lms_* columns into lms_connections. Idempotent — safe to re-run.
INSERT INTO lms_connections
  (user_id, provider, domain, access_token, refresh_token, token_expires_at, connected, synced_at)
SELECT id, lms_provider, lms_domain, lms_access_token, lms_refresh_token,
       lms_token_expires_at, lms_connected, lms_synced_at
FROM users
WHERE lms_provider IS NOT NULL AND lms_access_token IS NOT NULL
ON CONFLICT (user_id, provider) DO NOTHING;

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
-- Meeting schedule (weekday codes + time) used to auto-generate attendance sessions.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS meeting_days JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS meeting_time TEXT;
-- Attendance grading: whether attendance counts toward the grade, and its weight (percent).
ALTER TABLE classes ADD COLUMN IF NOT EXISTS attendance_graded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS attendance_weight NUMERIC(5,2);
-- LMS linkage: which external course (if any) this class is synced with.
-- external_source = 'canvas' | 'blackboard' | ...; external_course_id is that LMS's course id.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS external_source    TEXT;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS external_course_id TEXT;
-- One Summit class per (user, source, external course).
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_external
  ON classes(user_id, external_source, external_course_id)
  WHERE external_course_id IS NOT NULL;

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
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_priority') THEN
    CREATE TYPE assignment_priority AS ENUM ('none', 'low', 'medium', 'high');
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

-- Priority for calendar sorting/indicators (added later).
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS priority assignment_priority NOT NULL DEFAULT 'none';

-- Estimated effort in hours (nullable) — powers the weekly workload prediction.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,2);

-- LMS provenance: assignments pulled from Canvas/etc. carry the source + the
-- external assignment id, used to prevent duplicate imports and to show a badge.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS external_id     TEXT;
-- A given external assignment maps to at most one Summit assignment per class.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_external
  ON assignments(class_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

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

-- ============================================================================
-- Tier 2 features: notes, attendance, academic plan
-- ============================================================================

-- ----------------------------------------------------------------------------
-- class_files — uploaded documents (syllabus, notes, handouts) per class. For
-- the MVP the file bytes are stored inline as base64 in `data` so it works with
-- no object storage; `size_bytes` and `mime_type` drive the UI. category is one
-- of 'syllabus' | 'notes' | 'handouts' | 'other'.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT,
  category    TEXT NOT NULL DEFAULT 'other',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,                 -- base64-encoded file bytes
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_files_class_id ON class_files(class_id);

-- ----------------------------------------------------------------------------
-- notes — rich-text (Markdown) notes per class. Searchable by title/content.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Untitled note',
  content    TEXT NOT NULL DEFAULT '',               -- Markdown
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_class_id ON notes(class_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);

DROP TRIGGER IF EXISTS trg_notes_updated_at ON notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- attendance — one record per class session (date). Drives attendance %.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS attendance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  status       attendance_status NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_class_id ON attendance(class_id);

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- plan_items — 4-year academic plan. Courses planned per term (season + year).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_status') THEN
    CREATE TYPE plan_status AS ENUM ('planned', 'in_progress', 'completed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS plan_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year       INT  NOT NULL,
  season     TEXT NOT NULL,                           -- Spring | Summer | Fall | Winter
  name       TEXT NOT NULL,
  code       TEXT,
  credits    NUMERIC(4,2),
  status     plan_status NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_items_user_id ON plan_items(user_id);

DROP TRIGGER IF EXISTS trg_plan_items_updated_at ON plan_items;
CREATE TRIGGER trg_plan_items_updated_at
  BEFORE UPDATE ON plan_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
