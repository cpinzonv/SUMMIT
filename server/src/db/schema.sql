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

-- Role for admin-only features (analytics). Everyone defaults to 'user'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Subscription plan. 'free' = flashcards only; 'pro' = all Learn formats
-- (quizzes, podcasts, study guides, mind maps). No billing yet — promote with
-- UPDATE users SET plan='pro' ...; admins are treated as pro by premiumGate.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Feature gating / subscriptions. role may also be 'demo' (full access, like
-- admin). is_premium is a manual override; subscription_* + stripe_* back the
-- real billing flow (BILLING_ENABLED). Premium access = role admin/demo OR
-- is_premium OR an active pro tier (see featureGating.service.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium             BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier      TEXT NOT NULL DEFAULT 'free';   -- free | pro | none
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status    TEXT NOT NULL DEFAULT 'none';   -- active | cancelled | expired | none
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end_date   TIMESTAMPTZ;

-- OAuth social login (Google / Apple / GitHub). A user may sign up with email
-- OR a provider, and may LINK additional providers to one account (matched by
-- verified email). auth_method records how the account was first created.
-- password_hash is nullable: OAuth-only accounts have no password until they
-- set one. Each provider id is globally unique (partial index, NULLs allowed).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method     TEXT NOT NULL DEFAULT 'email';
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_email     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_key  ON users (apple_id)  WHERE apple_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_github_id_key ON users (github_id) WHERE github_id IS NOT NULL;

-- Two-factor auth (TOTP). Secret + backup codes are stored ENCRYPTED at rest.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret  TEXT;     -- encrypted base32 secret
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT;     -- encrypted JSON array

-- Account security & recovery.
--   email_verified  — new email signups must confirm a code; existing accounts,
--                     OAuth logins, and institution invites are auto-verified.
--   phone / recovery_email — optional recovery channels (verified before use).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verified') THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
    UPDATE users SET email_verified = true; -- grandfather every existing account
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone                  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email         CITEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email_verified BOOLEAN NOT NULL DEFAULT false;

-- Short-lived one-time codes for email/phone verification + password reset.
-- The 6-digit code is stored hashed; a background of attempts limits brute force.
CREATE TABLE IF NOT EXISTS verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,        -- signup | password_reset | change_email | recovery_email | phone
  code_hash   TEXT NOT NULL,
  destination TEXT,                 -- email/phone the code was sent to
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON verification_codes(user_id, purpose);

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

-- Graduation requirements: total credits needed to graduate (drives the
-- Planner's climb-to-graduation progress) and an optional per-semester target.
ALTER TABLE users ADD COLUMN IF NOT EXISTS graduation_credits      INTEGER NOT NULL DEFAULT 120;
ALTER TABLE users ADD COLUMN IF NOT EXISTS semester_credits        INTEGER;

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

-- How the connection was authorized: 'oauth' (authorize → code exchange, has a
-- refresh_token) or 'token' (student pasted a Canvas personal access token — no
-- refresh; on expiry we ask them to reconnect). Existing rows are OAuth.
ALTER TABLE lms_connections ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'oauth';

-- ----------------------------------------------------------------------------
-- lms_sync_log — append-only audit trail of every sync attempt (manual button
-- or the background cron), for debugging and the "last sync" status the UI
-- shows. One row per (user, provider) attempt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  trigger       TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'cron'
  status        TEXT NOT NULL,                     -- 'ok' | 'error'
  courses       INT  NOT NULL DEFAULT 0,
  imported      INT  NOT NULL DEFAULT 0,
  updated       INT  NOT NULL DEFAULT 0,
  grades        INT  NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lms_sync_log_user_provider
  ON lms_sync_log(user_id, provider, started_at DESC);

-- ----------------------------------------------------------------------------
-- canvas_config — admin-managed Canvas OAuth configuration (singleton row).
--
-- NOTE (stub): the running server still reads Canvas creds + the token
-- encryption key from ENV at boot (see config/env.js). This table stores what an
-- admin enters in Settings so it survives restarts and can later be wired to be
-- read at runtime. oauth_client_secret + token_encryption_key are stored
-- ENCRYPTED at rest and never returned to the client. The encryption key is
-- write-once (generate-if-absent) — overwriting it would make all existing
-- encrypted tokens/2FA secrets undecryptable, so the service refuses to replace it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_config (
  id                   INT PRIMARY KEY DEFAULT 1,
  instance_url         TEXT,
  oauth_client_id      TEXT,
  oauth_client_secret  TEXT,          -- encrypted
  token_encryption_key TEXT,          -- encrypted; write-once
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvas_config_singleton CHECK (id = 1)
);

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

-- Assignment submissions: optional text + an optional attached file (stored in
-- class_files, category 'submission'), stamped when submitted. Declared here so
-- the class_files FK target already exists.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS submission_text    TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS submission_file_id UUID REFERENCES class_files(id) ON DELETE SET NULL;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- Assignment detail workspace (tabbed modal): rich instructions, an in-app
-- "Working" scratchpad (HTML from the rich-text editor, autosaved), a per-file
-- link so uploads can belong to an assignment (instruction docs + submissions),
-- and a full submission history. `estimated_hours` (declared above) doubles as
-- the AI time estimate — decimal hours, e.g. 1.5 = 1h 30m.
-- ----------------------------------------------------------------------------
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS instructions     TEXT; -- rich HTML, separate from `description`
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS working_content  TEXT; -- Working tab (HTML), autosaved
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS working_saved_at TIMESTAMPTZ;

-- Files can belong to a specific assignment (instruction docs, submission files).
-- Nullable so existing class-level files (syllabus/notes) are unaffected.
ALTER TABLE class_files ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_class_files_assignment ON class_files(assignment_id);

-- Submission history — one row per submission attempt. kind:
--   'file'    → an uploaded completed-work file (file_id → class_files)
--   'link'    → an external URL (e.g. a Google Doc)  (url)
--   'working' → a snapshot copied from the Working tab (text = HTML)
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  text          TEXT,
  url           TEXT,
  file_id       UUID REFERENCES class_files(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions ON assignment_submissions(assignment_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- transcripts — lecture transcripts per class (pasted/uploaded text, or text
-- attached to an in-app recording). `audio_file_id` optionally links the stored
-- recording (a class_files row). `timestamps` holds optional HH:MM:SS markers.
-- Auto speech-to-text is pluggable and off by default, so a recording stores
-- the audio and an (initially empty) transcript the student can fill in.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcripts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id         UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Lecture transcript',
  content          TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'upload',   -- 'upload' | 'paste' | 'recording'
  audio_file_id    UUID REFERENCES class_files(id) ON DELETE SET NULL,
  duration_seconds INTEGER,
  recorded_date    DATE,
  timestamps       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI-generated summary of the transcript (Claude). Filled on demand from the
-- transcript content; used as the seed when "moving" a transcript to Notes.
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE INDEX IF NOT EXISTS idx_transcripts_class_id ON transcripts(class_id);

DROP TRIGGER IF EXISTS trg_transcripts_updated_at ON transcripts;
CREATE TRIGGER trg_transcripts_updated_at
  BEFORE UPDATE ON transcripts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
-- Archived notes are hidden from the default list (kept, not deleted).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Optional link to a lecture recording taken alongside the note. ON DELETE SET
-- NULL so deleting the recording just unlinks it (the note text is preserved).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS transcript_id UUID REFERENCES transcripts(id) ON DELETE SET NULL;

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

-- ----------------------------------------------------------------------------
-- Planner ↔ Dashboard linkage. A planned course (plan_items) auto-creates a
-- Dashboard class when its term starts, and archiving that class marks the
-- planned course completed. The two-way FKs are nullable + ON DELETE SET NULL,
-- so deleting either side just unlinks the other. Added here (after both tables
-- exist) to satisfy the cross-references.
-- ----------------------------------------------------------------------------
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS plan_item_id UUID REFERENCES plan_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_classes_plan_item ON classes(plan_item_id);

ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS completion_date DATE;
ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS linked_class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

-- ============================================================================
-- Learn tab — spaced-repetition flashcards + AI-generated study materials.
-- Cards are generated from a class's notes/files/transcripts (or authored by
-- hand); card_reviews is the source of truth for spaced repetition (SM-2), and
-- mastery_levels / streaks / stats cache derived state for fast dashboards.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'flashcard_source') THEN
    CREATE TYPE flashcard_source AS ENUM ('note', 'file', 'transcript');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'card_generator') THEN
    CREATE TYPE card_generator AS ENUM ('claude', 'user');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'card_difficulty') THEN
    CREATE TYPE card_difficulty AS ENUM ('easy', 'medium', 'hard');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mastery_status') THEN
    CREATE TYPE mastery_status AS ENUM ('new', 'learning', 'review', 'mastered');
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- flashcards — individual Q/A cards. source_id is POLYMORPHIC (points at a
-- note / class_file / transcript depending on source_type) so it is left as a
-- plain UUID, NOT a foreign key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flashcards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  explanation     TEXT,
  source_type     flashcard_source,
  source_id       UUID,                                   -- polymorphic; no FK
  generated_by    card_generator NOT NULL DEFAULT 'claude',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_edited     BOOLEAN NOT NULL DEFAULT false,
  custom_question TEXT,
  custom_answer   TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  difficulty      card_difficulty NOT NULL DEFAULT 'medium',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flashcards_class ON flashcards(class_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_user  ON flashcards(user_id);

DROP TRIGGER IF EXISTS trg_flashcards_updated_at ON flashcards;
CREATE TRIGGER trg_flashcards_updated_at
  BEFORE UPDATE ON flashcards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- decks — Anki-style grouping of a class's flashcards. Typically one deck per
-- source note (source_note_id), so cards generated from a note land together.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  source_note_id UUID,                                   -- note this deck came from
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decks_class ON decks(class_id);
-- One deck per (class, source note) so re-generating a note reuses its deck.
CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_class_note
  ON decks(class_id, source_note_id) WHERE source_note_id IS NOT NULL;

-- Which deck a card belongs to (nullable → "no deck"/legacy cards).
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS deck_id UUID REFERENCES decks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON flashcards(deck_id);

-- Study actions: suspend hides a card from study until unsuspended; bury hides
-- it until bury_until passes ("study later", typically +1 day).
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS bury_until   TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- card_reviews — one row per review. The SM-2 state AFTER the review is stored
-- inline so the latest row per card is the current schedule.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_reviews (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id            UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_spent_seconds INT,
  confidence         SMALLINT CHECK (confidence >= 1 AND confidence <= 5),
  correct            BOOLEAN,
  interval_days      INT,
  ease_factor        NUMERIC(3,2),
  next_review_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_next_review ON card_reviews(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_card_reviews_card ON card_reviews(card_id);

-- ----------------------------------------------------------------------------
-- learning_streaks — per-class (class_id set) and global (class_id NULL) daily
-- streaks. Partial unique indexes give us one row per (user, class) and one
-- global row per user for clean upserts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_streaks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id         UUID REFERENCES classes(id) ON DELETE CASCADE,
  current_streak   INT NOT NULL DEFAULT 0,
  longest_streak   INT NOT NULL DEFAULT 0,
  last_reviewed_at DATE,
  reviews_today    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_streak_global ON learning_streaks(user_id) WHERE class_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_streak_class  ON learning_streaks(user_id, class_id) WHERE class_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_learning_streaks_updated_at ON learning_streaks;
CREATE TRIGGER trg_learning_streaks_updated_at
  BEFORE UPDATE ON learning_streaks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- mastery_levels — cached per-(card,user) progression. One row per card+user.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mastery_levels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id            UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             mastery_status NOT NULL DEFAULT 'new',
  correct_count      INT NOT NULL DEFAULT 0,
  total_reviews      INT NOT NULL DEFAULT 0,
  confidence_average NUMERIC(3,2),
  mastery_percent    INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mastery_card_user ON mastery_levels(card_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_status ON mastery_levels(user_id, status);

DROP TRIGGER IF EXISTS trg_mastery_levels_updated_at ON mastery_levels;
CREATE TRIGGER trg_mastery_levels_updated_at
  BEFORE UPDATE ON mastery_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- learning_sessions — one row per study session (duration + focus metrics).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id           UUID REFERENCES classes(id) ON DELETE CASCADE,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  duration_minutes   INT,
  cards_reviewed     INT NOT NULL DEFAULT 0,
  cards_mastered     INT NOT NULL DEFAULT 0,
  average_confidence NUMERIC(3,2),
  interruptions      INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_user ON learning_sessions(user_id);

-- ----------------------------------------------------------------------------
-- podcasts — NotebookLM-style audio summaries. NOTE: Anthropic has no TTS, so
-- audio_url generation is a future seam; transcript_text can be generated now.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS podcasts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id           UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  audio_url          TEXT,
  transcript_text    TEXT,
  duration_seconds   INT,
  generated_from     TEXT[] NOT NULL DEFAULT '{}',
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  listened_at        TIMESTAMPTZ,
  completion_percent INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_podcasts_class ON podcasts(class_id);

DROP TRIGGER IF EXISTS trg_podcasts_updated_at ON podcasts;
CREATE TRIGGER trg_podcasts_updated_at
  BEFORE UPDATE ON podcasts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- quizzes — auto-generated; questions kept as JSONB for flexible item types.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quizzes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id           UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  question_count     INT,
  questions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempted_at       TIMESTAMPTZ,
  score              INT,
  time_spent_seconds INT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quizzes_class ON quizzes(class_id);

-- ----------------------------------------------------------------------------
-- study_guides — structured markdown summaries.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_guides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  generated_from TEXT[] NOT NULL DEFAULT '{}',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at        TIMESTAMPTZ,
  bookmarked     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_study_guides_class ON study_guides(class_id);

DROP TRIGGER IF EXISTS trg_study_guides_updated_at ON study_guides;
CREATE TRIGGER trg_study_guides_updated_at
  BEFORE UPDATE ON study_guides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- mind_maps — node/edge graph data as JSONB.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mind_maps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  topic          TEXT,
  nodes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges          JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_from TEXT[] NOT NULL DEFAULT '{}',
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mind_maps_class ON mind_maps(class_id);

-- ----------------------------------------------------------------------------
-- user_learning_stats — one aggregated row per user (dashboard cache).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_learning_stats (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_cards             INT NOT NULL DEFAULT 0,
  mastered_cards          INT NOT NULL DEFAULT 0,
  learning_cards          INT NOT NULL DEFAULT 0,
  new_cards               INT NOT NULL DEFAULT 0,
  global_streak           INT NOT NULL DEFAULT 0,
  longest_global_streak   INT NOT NULL DEFAULT 0,
  total_study_hours       NUMERIC(10,2) NOT NULL DEFAULT 0,
  average_session_minutes INT NOT NULL DEFAULT 0,
  average_mastery_percent INT NOT NULL DEFAULT 0,
  retention_rate          NUMERIC(3,2),
  total_badges_earned     INT NOT NULL DEFAULT 0,
  level                   INT NOT NULL DEFAULT 1,
  experience_points       INT NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_learning_stats_user ON user_learning_stats(user_id);

DROP TRIGGER IF EXISTS trg_user_learning_stats_updated_at ON user_learning_stats;
CREATE TRIGGER trg_user_learning_stats_updated_at
  BEFORE UPDATE ON user_learning_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Flashcard overhaul: Anki-style 3-phase scheduling + 4 card types.
-- card_reviews gains phase/learning_step/lapses (the `confidence` column now
-- stores the 1-4 rating: 1=Again 2=Hard 3=Good 4=Easy). flashcards gains a
-- card_type plus type-specific payloads (cloze parts, image + occlusion masks,
-- LaTeX). All nullable/defaulted so existing rows keep working.
-- ----------------------------------------------------------------------------
ALTER TABLE card_reviews ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'review'
  CHECK (phase IN ('learning', 'review', 'relearning'));
ALTER TABLE card_reviews ADD COLUMN IF NOT EXISTS learning_step SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE card_reviews ADD COLUMN IF NOT EXISTS lapses SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_card_reviews_phase_user ON card_reviews(user_id, phase, next_review_at);

ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT 'basic'
  CHECK (card_type IN ('basic', 'cloze', 'image', 'math'));
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS cloze_parts      JSONB;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS image_url        TEXT;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS occlusion_shapes JSONB;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS latex_content    TEXT;

-- ----------------------------------------------------------------------------
-- premium_whitelist — users an admin grants full premium access (close friends,
-- testers) without a subscription. One row per user; bypasses the paywall.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS premium_whitelist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  reason          TEXT,
  whitelisted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  whitelisted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Classic SM-2 (Woźniak 1990) scheduling. The current schedule now lives ON the
-- flashcards row (card_reviews stays as an append-only history log for stats).
-- `sm2_interval` is named to avoid the reserved word `interval`.
-- ----------------------------------------------------------------------------
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS ease_factor      NUMERIC(4,2) NOT NULL DEFAULT 2.5;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS sm2_interval     INTEGER NOT NULL DEFAULT 0;   -- days until next review
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS repetitions      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS next_review_date TIMESTAMPTZ;                  -- NULL = brand-new, due now
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS daily_position   INTEGER;                      -- order in today's queue
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(user_id, next_review_date);

-- Per-deck study configuration: deadline, daily limits, interleaving.
CREATE TABLE IF NOT EXISTS deck_settings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id                UUID NOT NULL UNIQUE REFERENCES decks(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deadline               TIMESTAMPTZ,
  daily_new_card_limit   INTEGER NOT NULL DEFAULT 20,
  max_cards_per_session  INTEGER NOT NULL DEFAULT 30,
  interleaving_enabled   BOOLEAN NOT NULL DEFAULT false,
  user_daily_study_limit INTEGER NOT NULL DEFAULT 100,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deck_settings_user ON deck_settings(user_id);
DROP TRIGGER IF EXISTS trg_deck_settings_updated_at ON deck_settings;
CREATE TRIGGER trg_deck_settings_updated_at
  BEFORE UPDATE ON deck_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-deck, per-day study tracking (drives limits + on-track calculations).
CREATE TABLE IF NOT EXISTS deck_study_stats (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id             UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  new_cards_added     INTEGER NOT NULL DEFAULT 0,
  cards_reviewed      INTEGER NOT NULL DEFAULT 0,
  total_interactions  INTEGER NOT NULL DEFAULT 0,
  average_ease_factor NUMERIC(4,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deck_stats_day ON deck_study_stats(deck_id, user_id, date);

-- ============================================================================
-- Institutions (multi-tenancy) — B2B onboarding. A super-admin (role 'admin')
-- provisions an institution + an 'institution_admin' user (school IT). Feature
-- tiers are stored here now; app-wide ENFORCEMENT lands in Phase 2. Revoke is a
-- hard block (login + token refresh are refused for the institution's users).
-- ============================================================================
CREATE TABLE IF NOT EXISTS institutions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  admin_email    CITEXT NOT NULL,
  contract_start DATE,
  contract_end   DATE,
  lms_type       TEXT,                                  -- canvas | blackboard | ...
  student_seats  INTEGER NOT NULL DEFAULT 0,            -- soft cap (display only)
  tier           TEXT NOT NULL DEFAULT 'basic',         -- basic | pro
  feature_flags  JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { transcription, summaries, ... }
  revoked_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_institutions_admin_email ON institutions(admin_email);

DROP TRIGGER IF EXISTS trg_institutions_updated_at ON institutions;
CREATE TRIGGER trg_institutions_updated_at
  BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which institution a user belongs to (NULL = ordinary individual user). The
-- institution's admin has role 'institution_admin'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_institution_id ON users(institution_id);

-- One-time, expiring set-password invite tokens (only the SHA-256 hash is stored).
CREATE TABLE IF NOT EXISTS user_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_invites_user_id ON user_invites(user_id);

-- ============================================================================
-- Activities — 3-level anti-procrastination hierarchy: Activity → Project → Task.
-- An Activity is non-class work (club, freelance, volunteering). Each Activity
-- holds Projects (sub-goals) that carry the Kanban stage; each Project holds
-- actionable Tasks with optional due dates. Task done = completed_at is set.
-- Progress aggregates upward (project = its tasks; activity = all its tasks).
-- See docs/activities.md.
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_stage') THEN
    CREATE TYPE activity_stage AS ENUM ('backlog', 'active', 'in_progress', 'done');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  color        TEXT,                                   -- hex, for card styling
  kind         TEXT NOT NULL DEFAULT 'other',          -- club | extracurricular | freelance | volunteer | other
  stage        activity_stage NOT NULL DEFAULT 'backlog', -- activity-level (Phase B board); detail uses project stages
  completed_at TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
DROP TRIGGER IF EXISTS trg_activities_updated_at ON activities;
CREATE TRIGGER trg_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Projects — sub-goals within an activity; carry the Kanban stage.
CREATE TABLE IF NOT EXISTS activity_projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  stage        activity_stage NOT NULL DEFAULT 'backlog',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_projects_activity_id ON activity_projects(activity_id);
DROP TRIGGER IF EXISTS trg_activity_projects_updated_at ON activity_projects;
CREATE TRIGGER trg_activity_projects_updated_at BEFORE UPDATE ON activity_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tasks — actionable steps under a project. Done = completed_at set; due_date optional.
CREATE TABLE IF NOT EXISTS activity_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES activity_projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  due_date     TIMESTAMPTZ,
  planned_date TIMESTAMPTZ,                            -- for calendar drag-reschedule (Phase C)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE activity_tasks ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_activity_tasks_project_id ON activity_tasks(project_id);
DROP TRIGGER IF EXISTS trg_activity_tasks_updated_at ON activity_tasks;
CREATE TRIGGER trg_activity_tasks_updated_at BEFORE UPDATE ON activity_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- To-Do board — a Kanban stage shared by assignments + activity tasks, and by
-- BOTH the global To-Do board and the per-class assignment boards (single source
-- of truth: a move on one board is a move on the other).
--
-- Default columns: Not Started · In Progress · Done. Backlog + Planning are
-- optional (a user preference); they sort before Not Started. The one-time
-- backfills seed board_stage from existing status so a schema re-apply on
-- restart never clobbers a user's later drags.
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'board_stage') THEN
    CREATE TYPE board_stage AS ENUM ('backlog', 'planning', 'not_started', 'in_progress', 'done');
  END IF;
END $$;

-- Assignments: add board_stage (+ completed_at) and seed once on first add.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'assignments' AND column_name = 'board_stage'
  ) THEN
    ALTER TABLE assignments ADD COLUMN board_stage board_stage NOT NULL DEFAULT 'not_started';
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    UPDATE assignments SET board_stage = CASE
      WHEN status = 'in_progress' THEN 'in_progress'::board_stage
      WHEN status IN ('submitted', 'graded') THEN 'done'::board_stage
      ELSE 'not_started'::board_stage END;
    UPDATE assignments SET completed_at = updated_at
     WHERE status IN ('submitted', 'graded') AND completed_at IS NULL;
  END IF;
END $$;

-- Activity tasks: add board_stage and seed once from completed_at.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'activity_tasks' AND column_name = 'board_stage'
  ) THEN
    ALTER TABLE activity_tasks ADD COLUMN board_stage board_stage NOT NULL DEFAULT 'not_started';
    UPDATE activity_tasks SET board_stage = CASE
      WHEN completed_at IS NOT NULL THEN 'done'::board_stage
      ELSE 'not_started'::board_stage END;
  END IF;
END $$;

-- New rows land in Not Started (idempotent; also corrects any DB whose column
-- was first created with the earlier 'backlog' default).
ALTER TABLE assignments ALTER COLUMN board_stage SET DEFAULT 'not_started';
ALTER TABLE activity_tasks ALTER COLUMN board_stage SET DEFAULT 'not_started';

-- ----------------------------------------------------------------------------
-- security_events — append-only audit trail for account-security actions
-- (logins, password changes/resets, 2FA enable/disable). Stores who/what/when/
-- outcome + client IP; NEVER passwords, tokens, or codes. user_id is nullable so
-- a failed login for an unknown email is still recorded. Retained for review.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  email      CITEXT,                              -- the attempted/affected email
  action     TEXT NOT NULL,                       -- 'login' | 'password_change' | '2fa_enable' | …
  outcome    TEXT NOT NULL,                       -- 'success' | 'failure'
  ip         TEXT,
  detail     JSONB,                               -- small, non-sensitive context
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_action ON security_events(action, created_at DESC);

-- ----------------------------------------------------------------------------
-- trusted_devices — "remember this device" for 2FA. When a user opts in on the
-- 2FA screen, we mint a random per-device trust token, hand the raw token to the
-- browser (localStorage), and store only its SHA-256 hash here with a 30-day
-- expiry. On the next login the browser presents the token; a live, unexpired,
-- unrevoked match for that user (and same browser) lets them skip the 2FA step.
-- The token — not the user_agent/ip — is the secret; UA/IP are for display + a
-- soft binding, so a leaked token can't be used from a wildly different browser.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,          -- sha256(raw device token)
  ua_hash      TEXT,                    -- sha256(user agent) — soft binding
  label        TEXT,                    -- "Chrome on macOS" (parsed from UA)
  user_agent   TEXT,
  ip           TEXT,                    -- last-seen IP (display only)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(token_hash);

-- ============================================================================
-- MONETIZATION INFRASTRUCTURE — founding members, tiers, usage gates, fake-door
-- paywall. All fake-door until BILLING_ENABLED + paywall_enabled flip on. No
-- charging, no Stripe. See server/src/config/tiers.js + services/billing.*.
-- ============================================================================

-- Runtime-editable flags (admin panel). value is JSONB so each flag can carry a
-- small object. paywall_enabled gates fake-door → real-checkout mode;
-- founding_member_cap is the hard cap on founding slots.
CREATE TABLE IF NOT EXISTS feature_flags (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO feature_flags (key, value) VALUES
  ('paywall_enabled', '{"enabled": false}'::jsonb),
  ('founding_member_cap', '{"cap": 500}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Tier + founding-member columns on users. `tier` is the paid tier (free/pro/max),
-- distinct from the legacy subscription_tier. Founding members get
-- pro_until = signup + 1 year; effective tier falls back to `tier` once expired.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_member BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_member_number INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until TIMESTAMPTZ;
-- Guard on pg_constraint so re-running is idempotent. (A bare EXCEPTION WHEN
-- duplicate_object misses the UNIQUE case, which raises duplicate_table/42P07
-- for the backing index — that would fail every deploy after the first.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tier_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_tier_check CHECK (tier IN ('free','pro','max'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_founding_number_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_founding_number_unique UNIQUE (founding_member_number);
  END IF;
END $$;

-- Per-user, per-metric, per-period usage. period_key is 'YYYY-MM' (monthly),
-- 'YYYY-S1'/'YYYY-S2' (semester: S1=Jan1-Jun30, S2=Jul1-Dec31), or 'lifetime'.
CREATE TABLE IF NOT EXISTS usage_counters (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL CHECK (metric IN ('extraction','ai_cards','transcription_minutes','podcasts')),
  period_key TEXT NOT NULL,
  amount     NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (user_id, metric, period_key)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user ON usage_counters(user_id, metric, period_key);

-- Conversion-intent analytics for the paywall (fake-door). One row per event.
CREATE TABLE IF NOT EXISTS gate_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  gate         TEXT,
  tier_at_time TEXT,
  action       TEXT NOT NULL CHECK (action IN ('shown','claimed_founding','joined_waitlist','dismissed','upgraded')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gate_events_gate ON gate_events(gate, action, created_at DESC);
-- account_type distinguishes B2C (self-pay) vs institutional (school-paid) events,
-- so the admin gate analytics can split conversion intent by audience.
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS account_type TEXT;

-- Waitlist (fake-door Mode B). One row per user.
CREATE TABLE IF NOT EXISTS waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email           TEXT,
  interested_tier TEXT,
  source_gate     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time backfill: assign founding numbers to existing users by signup order,
-- up to the configured cap. Idempotent — only touches users without a number and
-- never exceeds the cap, so re-running on each deploy is safe. (New signups get
-- their number via the race-safe claim path in billing.service.js.)
DO $$
DECLARE
  v_cap    INTEGER;
  v_count  INTEGER;
  v_maxnum INTEGER;
  v_slots  INTEGER;
BEGIN
  SELECT COALESCE((value->>'cap')::int, 500) INTO v_cap FROM feature_flags WHERE key = 'founding_member_cap';
  v_cap := COALESCE(v_cap, 500);
  SELECT count(*) INTO v_count FROM users WHERE founding_member_number IS NOT NULL;
  SELECT COALESCE(max(founding_member_number), 0) INTO v_maxnum FROM users;
  v_slots := GREATEST(v_cap - v_count, 0);
  IF v_slots > 0 THEN
    WITH to_assign AS (
      SELECT id, (row_number() OVER (ORDER BY created_at, id)) + v_maxnum AS n
        FROM users
       WHERE founding_member_number IS NULL
       ORDER BY created_at, id
       LIMIT v_slots
    )
    UPDATE users u
       SET founding_member = true,
           founding_member_number = t.n,
           pro_until = COALESCE(u.pro_until, now() + interval '1 year')
      FROM to_assign t
     WHERE u.id = t.id;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- audit_logs — append-only FERPA audit trail: WHO accessed / exported / deleted
-- WHOSE educational record, and who performed admin actions. Stores ids, counts,
-- and non-sensitive context ONLY — never record values (grades, transcript text,
-- note bodies, file contents…). Written best-effort by
-- services/audit.service.logAudit(), which never blocks or fails a request.
-- Append-only by convention: the app issues INSERTs only, never UPDATE/DELETE.
-- No FK constraints so a user/institution deletion never rewrites audit history
-- and logging can never fail on a missing reference.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id      UUID,          -- who acted (null = unauthenticated/system, e.g. bootstrap)
  actor_role         TEXT,          -- actor's role at the time: user | demo | admin | institution_admin
  tenant_id          UUID,          -- institution context, when applicable
  action             TEXT NOT NULL, -- 'record.view' | 'record.export' | 'record.delete' | 'admin.role_grant' | …
  target_type        TEXT,          -- 'class' | 'assignment' | 'transcript' | 'note' | 'file' | 'attendance' | 'archive' | 'institution' | 'user'
  target_id          TEXT,          -- id (or email) of the thing acted on
  subject_student_id UUID,          -- WHOSE educational record this concerns (null for non-record admin actions)
  ip                 TEXT,
  user_agent         TEXT,
  metadata           JSONB          -- ids / counts / flags only — never record values
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_subject ON audit_logs(subject_student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant  ON audit_logs(tenant_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- Session & 2FA hardening (SECURITY_AUDIT M5/L3/M6). Refresh tokens gain a
-- rotation family + lineage + device context so reuse can be detected and whole
-- families revoked; users gain the last-consumed TOTP step for replay protection.
-- All nullable / IF NOT EXISTS so existing rows are untouched (no table rewrite).
-- ----------------------------------------------------------------------------
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id   UUID;   -- rotation family (theft → revoke whole family)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by UUID;   -- the token this one rotated into
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent  TEXT;   -- device context (display / soft binding)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip          TEXT;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;       -- last consumed TOTP step (single-use per step)
