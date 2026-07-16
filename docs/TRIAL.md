# Trial dataset

A one-command way to fill a **dedicated trial account** with a full, deliberately
messy, realistic semester so every Summit feature can be exercised against real
data — plus a set of **upload fixtures** for the AI-extraction flows (which can't
be seeded and have to go in as real uploads through the UI).

- **Seeder:** [`server/src/db/seed-trial.js`](../server/src/db/seed-trial.js) — a CLI script (not an HTTP endpoint).
- **Fixtures:** [`docs/test-fixtures/`](test-fixtures/) — download and upload these through the UI.

---

## Trial account

| | |
|---|---|
| **Email** | `trial@student.app` |
| **Password** | `TrialStudent#2026` |

Created if missing with role `demo` — the project's full-access pattern (same as
the existing demo seed), so every paywalled Learn format is usable regardless of
`BILLING_ENABLED` and the client's computed `premium` flag reads true. Timezone is
`America/Chicago` (so the app exercises user-timezone rendering, not UTC).

---

## Running it

`dotenv` loads `server/.env`, so run from the **server workspace**:

```bash
cd server

# Seed the trial account (no-op if it already has data)
node src/db/seed-trial.js

# Wipe the trial account and rebuild from scratch
node src/db/seed-trial.js --reset
```

Against a remote / Railway database:

```bash
railway run node src/db/seed-trial.js --reset --yes-i-mean-it
```

### Flags

| Flag | Effect |
|---|---|
| `--reset` | Wipe the trial account's data and rebuild. Without it, an already-seeded account is left untouched (idempotent). |
| `--yes-i-mean-it` | Required when `DATABASE_URL` looks production-like (remote host or `NODE_ENV=production`). The seeder only ever touches the one trial account, but this makes running against prod deliberate. |
| `--email=ADDR` | Target a different trial email (still one account only). |
| `--term="Fall 2026"` | Pin the term label (default: derived from the anchor date). |
| `--today=YYYY-MM-DD` | Pin "today" (default: the run date). |

### Safety

- **Only the trial account is ever read or written.** Every delete is scoped to
  the trial user id — no other account's data is touched.
- The wipe reuses the **PR #77 purge-cascade order**: delete the three tables
  that hold the user's rows via `SET NULL` / no-FK (`security_events`,
  `gate_events`, `audit_logs`), then `DELETE FROM users` so `ON DELETE CASCADE`
  removes everything else with nothing orphaned. The account is then recreated
  and reseeded in the same transaction.
- **Nothing here creates or alters schema.** It does not touch
  `/admin/seed-database`.

### Dates float with the run date

The whole semester is **anchored around "today"** (about 9 weeks in, 7 to go), so
the account always looks mid-semester: past attendance, overdue + due-today work,
a deliberately overloaded day this week, upcoming deadlines, and spaced-repetition
cards at every stage. That means the term label is derived from the anchor (e.g.
running it in July labels the term `Summer`); pass `--term="Fall 2026"` to pin it.

### Degree Requirements is feature-detected

The Degree Requirements (R-features) tables live on `feat/degree-requirements`
and are **not in `main`** yet. The seeder detects them: it seeds the full
requirements dataset when the tables exist, and prints a one-line skip note when
they don't. Everything else seeds regardless.

---

## What gets seeded → which feature it exercises

| Seeded scenario | Feature it tests |
|---|---|
| 6 classes: MWF-morning, TTh-afternoon, an **evening** class, an **online class with no meeting times**, and one with a **Friday lab at a different time** | Class list / schedule timetable; empty-schedule handling; multi-block days |
| One class (COMP 271) with a **weighted grading scheme** (HW/Exams/Project) | Grade calculator category weights |
| ~48 assignments spread across classes | To-Do calendar (month/week/day/year), board, table |
| **5 overdue**, **3 due today**, a cluster **due this week** | Overdue badges, due-today, "this week" load |
| One day this week **overloaded to ~7h** with `scheduled_time` left unset | Schedule load chips lighting up + the **unscheduled tray** / ghost auto-placement |
| ~10 assignments with `scheduled_time` set | Schedule **day view** placed time-blocks |
| `planned_date` differing from `due_date` on several | Planned-vs-due scheduling |
| AI time estimates on most; **3 with none** | Weekly workload prediction + missing-estimate handling |
| Status/board mix incl. `backlog` + `planning` | To-Do Kanban stages |
| 13 graded assignments (strong/weak mix) per class | Per-class GPA / grade roll-up |
| Attendance marked across past sessions (present/late/absent/excused) | Attendance %; ECON & PHIL have attendance **graded** so it feeds the grade |
| Rich-text instructions; **file + link + working** submissions; an attached file; a class syllabus file | Assignment detail modal (Instructions/Working/Submissions), Files tab |
| Notes: long-with-headings, **LaTeX math**, short | Notes editor + math rendering |
| A lecture transcript with a **stored AI summary** | Transcripts + "summarize" output (seeded, no API call) |
| **3 flashcard decks** — new / learning / mature (with SM-2 history) + streaks + stats | Learn decks, progress bars, due queue, streaks |
| A **podcast**, **study guide**, **quiz (with an attempt)**, **mind map** — all stored outputs | Learn premium formats (no paid API calls in the seeder) |
| 2 activities → projects (varied stages) → tasks, incl. one project **3/4 done** | Activities 3-level hierarchy + near-auto-complete |
| Roadmap (`plan_items`) partially filled, incl. **DATA 212 placed without its prereq** | Planner roadmap + auto-fill + **blocked-placement** message |
| Degree program (B.S. Data Science): prereq **chain 118→161→162→212**, an **OR-group** (`MATH 161 OR PLACEMENT`), a **summer-only** mid-chain course, a **pick-3-of-8** electives tray, a **no-course-list** category, 4 completed/transferred/AP courses, `PLACEMENT` met | Degree Requirements progress, prereq/offerings enforcement, the R3 "You choose" tray |
| Draft Semester Plan: ~5 courses × 3-4 sections, **an engineered all-collide pair** (PHIL 201 + HIST 210 both MWF 10:00), varied professors, one **section with no times** | Semester Plan Builder: zero-conflict-free explanation, prefer/avoid, unschedulable flag |

---

## Upload fixtures (AI extraction flows)

The extraction flows read a real upload, so these ship as files to upload through
the UI. All content is obviously fake.

| File | Upload through | Exercises |
|---|---|---|
| [`syllabus-clean.pdf`](test-fixtures/syllabus-clean.pdf) | Class → import syllabus | Clean, well-structured extraction (dates, grading table, schedule) |
| [`syllabus-messy.pdf`](test-fixtures/syllabus-messy.pdf) | Class → import syllabus | Messy extraction: mixed date formats, grading in prose, schedule buried in paragraphs |
| [`sections-listing.txt`](test-fixtures/sections-listing.txt) | Planner → Semester Plan Builder → **paste** | Section extraction from pasted portal text |
| [`sections-listing.png`](test-fixtures/sections-listing.png) | Planner → Semester Plan Builder → **screenshot** | Section extraction from an ugly portal "screenshot" (vision), incl. conflicts, online/TBA, a lab |
| [`degree-requirements.pdf`](test-fixtures/degree-requirements.pdf) | Planner → Degree Requirements → import | Requirement extraction: categories, credits, course lists, **prose prerequisites**, offered-term notes, a no-course-list category |

### Regenerating the fixtures

```bash
node docs/test-fixtures/generate-fixtures.mjs
```

Uses the Node standard library only (a small text-based PDF writer and a
`zlib`-based PNG encoder with an embedded bitmap font) — no extra dependencies,
runs the same on macOS and Linux.
