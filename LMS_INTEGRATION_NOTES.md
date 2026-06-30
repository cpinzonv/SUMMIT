# LMS Integrations — overnight build notes

Five new LMS integrations were added alongside Canvas: **Blackboard, Google
Classroom, Brightspace (D2L), Moodle, Sakai**. Each is committed separately.

## The one design decision you should know about

Your spec described per-LMS columns (`[lms]_access_token`, `[lms]_connected`,
`[lms]_instance_url`) and a separate `[lms]Service.js` per LMS. The Canvas
integration you already built is actually a **provider-agnostic registry**
(`server/src/services/lms/`) — its own comments say "add Blackboard/Brightspace/
Moodle by writing one module and registering it here." So "follow the same
pattern as Canvas" was implemented as **five provider modules in that registry**,
not five parallel services with duplicated columns.

One deliberate change to the data model: your per-LMS UI (independent Connect/
status/sync per provider) requires connecting more than one LMS at once, but the
old schema stored a single connection in `users.lms_*`. Connections now live in a
new **`lms_connections`** table keyed by `(user_id, provider)` — the same data
your spec named (`access_token`, `connected`, `domain`/instance_url), just shaped
to allow simultaneous connections. A backfill migration moves your existing
Canvas connection in, so **Canvas keeps working**.

## What's in each integration

Backend (per provider): a module under `server/src/services/lms/` implementing
OAuth2 + course/assignment normalizers; registered in `services/lms/index.js`.
Routes are mounted per provider, e.g. `GET /api/blackboard/sync`,
`GET /api/moodle/sync`, plus `GET /api/lms/status` for all of them. Assignments
map to the Summit schema (title, due_date, point_value, course) and are
de-duplicated by `(class_id, external_source, external_id)`. Tokens are stored
**encrypted** (AES-256-GCM), same as Canvas.

Frontend: Settings → Preferences shows a Connect/status card per provider;
the Dashboard shows a per-provider "Sync" button; the class ⋮ menu offers
"Import assignments from <LMS>" and "Sync <LMS> assignments" per provider
(disabled with a tooltip when that LMS isn't connected); a provenance badge marks
each synced assignment's source. Toasts report sync/import status.

## How to test in the morning

**Mock mode is already on** (`server/.env` has `LMS_MOCK=true` and a generated
`LMS_TOKEN_ENC_KEY`). With it on, all six providers connect/sync/import against
built-in fixtures — no real credentials needed. Each provider returns its own
distinct demo courses so you can see them land on the dashboard + calendar.

1. `npm run db:migrate --workspace=server` (creates `lms_connections`).
2. Start the app, open **Settings → Preferences**, click **Connect** on any LMS
   (mock mode bounces you straight through OAuth), then **Sync now**.
3. Check the dashboard/calendar for the synced assignments, and try
   **Import assignments from <LMS>** in a class's ⋮ menu.

**Automated pipeline test (no DB needed):**
`npm run test:lms --workspace=server` — drives the real service + all six
providers through connect→sync→dedupe→import and asserts encrypted tokens,
created classes/assignments/grades, and dedupe. All six pass.

**Going live with real credentials:** in `server/.env`, set the provider's
`*_CLIENT_ID` / `*_CLIENT_SECRET` (see `server/.env.example`) and set
`LMS_MOCK=false` (or mock providers individually with `MOCK_<PROVIDER>_MODE`).

## Honest limitations (sandbox couldn't do these; please verify)

- **No real Postgres or browser was available in the build sandbox**, so the
  pipeline was verified through the in-memory integration test and the client was
  verified to parse, but I could not click through the live UI or run the real
  SQL. Please run the migration + a real sync once.
- **The real-API code paths are best-effort and unverified against live
  instances.** Mock mode is solid; the real OAuth/endpoints for each LMS are
  written to each vendor's documented API but need a real account to confirm.
  Notable per-provider caveats are in each module's header comment — especially
  **Moodle** (uses a web-service token; OAuth2 only if the site runs an OAuth2
  server) and **Sakai** (OAuth provider tool vs. session auth varies by deploy).
- Grades are mapped where the API exposes them simply (Canvas, Blackboard,
  Google Classroom, Moodle); Brightspace and Sakai leave per-student grade
  fetching for the real-credential pass (assignments still import).
