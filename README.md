# Student Workflow App

Track classes, assignments, and grades across a semester.

**Stack:** Node.js + Express · PostgreSQL · React (web) · Electron (desktop) · Railway (hosting)

## Monorepo layout

```
.
├── server/      # Express API + PostgreSQL schema  (Phase 1 — done)
│   └── src/
│       ├── config/      # env + pg pool
│       ├── db/          # schema.sql, migrate.js, seed.js
│       ├── middleware/  # auth, validation, error handling
│       ├── routes/      # auth (live) + classes/assignments/grades/archives (stubs)
│       ├── controllers/ # request/response + zod schemas
│       ├── services/    # business logic + SQL
│       └── utils/       # jwt, AppError, asyncHandler
├── client/      # React web app        (Phase 3 — done)
└── desktop/     # Electron shell       (Phase 4 — done)
    ├── electron/    # main process + preload (app:// protocol, auto-updates)
    └── renderer/    # built React client, packaged into the app (gitignored)
```

## Database schema

| Table            | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `users`          | Students (email, password hash, profile).                          |
| `refresh_tokens` | Hashed, revocable refresh tokens for rotation.                     |
| `classes`        | Courses per term incl. syllabus data (meeting times, grading scheme). |
| `assignments`    | Work items with due **and** planned dates, point value, status.    |
| `grades`         | One score per assignment; `points_possible` denormalized for stability. |
| `archives`       | JSON snapshots of finished classes/terms.                          |

Grades store raw scores; weighted GPA/grade roll-ups are computed in the app
from each class's `grading_scheme` (Phase 2).

## Prerequisites

- **Node.js ≥ 18** and npm
- **PostgreSQL ≥ 13** running locally (or a Railway database URL)

On macOS with Homebrew:

```bash
brew install node postgresql@16
brew services start postgresql@16
createdb student_workflow
```

## Getting started (server)

```bash
# 1. Install dependencies (root installs all workspaces)
npm install

# 2. Configure environment
cp server/.env.example server/.env
#    edit server/.env — set DATABASE_URL and generate JWT secrets:
#    openssl rand -hex 32

# 3. Create the schema
npm run db:migrate

# 4. (optional) Seed demo data — demo@student.app / password123
npm run db:seed

# 5. Run the API in watch mode
npm run dev
# → http://localhost:4000/health
```

## Getting started (web client)

With the API running (above):

```bash
npm run dev --workspace=client
# → http://localhost:5173  (uses VITE_API_URL, default http://localhost:4000)
```

Log in with the demo account (`demo@student.app` / `password123`). The client
persists tokens to `localStorage`, auto-refreshes expired access tokens, and
redirects to `/login` when unauthenticated. Pages: Dashboard, Class detail,
Calendar (due dates solid / planned dates faded), New class, Archives.
The dev port `5173` must match an entry in the API's `CORS_ORIGINS`.

## Getting started (desktop app)

The Electron shell wraps the React client. In **dev** it loads the React dev
server over HTTP on port **3000**; in **production** it serves the built renderer
from disk via a custom `app://bundle` protocol (with SPA fallback so React Router
works).

```bash
# Dev: starts the React dev server on :3000 AND launches Electron together.
# (Run the API separately: npm run dev --workspace=server)
npm run dev --workspace=desktop

# Package: build the renderer into desktop/renderer and produce an app bundle.
npm run pack --workspace=desktop    # unpacked .app (fast, unsigned) → desktop/dist/
npm run dist --workspace=desktop    # full installers (dmg/zip) + auto-update metadata
```

- The API must allow the renderer's origin: `http://localhost:3000` (dev) and
  `app://bundle` (packaged). Both are in the default `CORS_ORIGINS`.
- For a packaged build pointing at a deployed backend, set `VITE_API_URL` at build
  time (it's baked into the renderer).
- **Auto-updates** use `electron-updater` and only run in a packaged build. Configure
  the `build.publish` provider in `desktop/package.json` and run `npm run dist` to
  generate the release feed + `app-update.yml`.

## API (Phase 1)

| Method | Path                | Auth   | Body                                   |
| ------ | ------------------- | ------ | -------------------------------------- |
| GET    | `/health`           | —      | —                                      |
| POST   | `/api/auth/register`| —      | `email, password, fullName, school?`   |
| POST   | `/api/auth/login`   | —      | `email, password`                      |
| POST   | `/api/auth/refresh` | —      | `refreshToken`                         |
| POST   | `/api/auth/logout`  | —      | `refreshToken`                         |
| GET    | `/api/auth/me`      | Bearer | —                                      |

`register`/`login`/`refresh` return `{ user, accessToken, refreshToken }`.
Send the access token as `Authorization: Bearer <token>` on protected routes.

## API (Phase 2 — classes, assignments, grades, archives)

All routes below require `Authorization: Bearer <accessToken>` and are scoped to
the authenticated student (other users' data returns `404`).

| Method | Path                              | Body                                                        |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/classes`                    | `name` (req), `code?`, `term?`, `credits?`, `color?`, `startDate?`, `endDate?`, `syllabus?` |
| GET    | `/api/classes`                    | — (active classes, each with `currentGrade`)                |
| POST   | `/api/classes/:id/assignments`    | `title` (req), `description?`, `category?`, `dueDate?`, `plannedDate?`, `pointValue?`, `status?` |
| GET    | `/api/classes/:id/assignments`    | — (each includes its `grade`, ordered by due date)          |
| PATCH  | `/api/assignments/:assignmentId`  | any subset of the create fields (nullable to clear)         |
| DELETE | `/api/assignments/:assignmentId`  | — (grade cascades)                                          |
| POST   | `/api/grades`                     | `assignmentId` (req), `pointsEarned` (req), `pointsPossible?`, `feedback?` |
| PUT    | `/api/classes/:id/archive`        | — (snapshots the class + final grade into `archives`)       |
| GET    | `/api/archives`                   | — (archived class snapshots, newest first)                  |

- **`syllabus`** object: `{ instructor?, instructorEmail?, location?, meetingTimes?, gradingScheme?, syllabusUrl? }`.
- **Grade auto-calculation:** `POST /api/grades` returns `{ grade, classId, classGrade }`,
  where `classGrade` is recomputed from point totals: `{ pointsEarned, pointsPossible,
  percentage, letter, gradedAssignments }`. `pointsPossible` defaults to the assignment's
  `pointValue`. One grade per assignment — re-posting updates it (upsert) and flips the
  assignment's status to `graded`.
- **Archiving** stamps `classes.archived_at` (so it drops out of `GET /api/classes`) and
  writes an immutable point-in-time snapshot (class + assignments + final grade) into the
  `archives` table. Idempotent.

### Quick smoke test

```bash
curl -s localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"me@school.edu","password":"password123","fullName":"Me"}'
```

## Roadmap

- **Phase 1 — done:** project structure, DB schema, Express + auth.
- **Phase 2 — done:** CRUD for classes/assignments, grade submission with
  point-based auto-calculation, archiving.
- **Phase 3 — done:** React web client (Vite + Tailwind + Axios) — login/register,
  dashboard, class detail, calendar, create-class, archives. See `client/`.
- **Phase 3.5 — done:** calendar event modal, grade submission + edit modal,
  edit/delete assignments (PATCH/DELETE `/api/assignments/:id`), dashboard GPA.
- **Phase 4 — done:** Electron desktop shell (`desktop/`) — dev orchestration,
  `app://` protocol packaging, auto-updates via electron-updater. Verified in dev,
  unpacked-prod, and fully-packaged builds.
- **Deploy:** Railway (provides `DATABASE_URL`; set `DATABASE_SSL=true` and JWT secrets).

## Notes

- `migrate.js` applies `schema.sql` directly and is idempotent. Move to a
  versioned migration tool (e.g. `node-pg-migrate`) before the schema starts
  changing in production.
