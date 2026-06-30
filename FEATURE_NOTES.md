# Overnight feature build — review notes

All 13 features are built and committed (one commit each, messages prefixed
"Add feature: …"). This is on top of the 5 LMS integrations (see
`LMS_INTEGRATION_NOTES.md`).

## First, run the migration

Several features add columns/tables. The schema is idempotent — run once:

```
npm run db:migrate --workspace=server
```

New schema: `lms_connections`, `gcal_events`, `class_files` tables;
`users.referral_source(_detail)`, `users.gcal_*`; `assignments.estimated_hours`.

## What each feature does + where to look

1. **Smooth archive animation** — hover a dashboard class card/row → 🗄 archive
   button; it fades + slides up before removal. Class detail header animates on
   Archive too.
2. **Past-due assignments** — red OVERDUE / "N days late" badge + light-red row
   in a class's Assignments tab; red dot on the calendar; "N overdue" pill on
   dashboard cards.
3. **Days-left counter** — "Due today / tomorrow / N days left" under due dates,
   a "Next due" hint on dashboard cards, and in the calendar event details.
   Computed at render time, so it advances daily.
4. **Class color** — Edit class → color picker (swatches + custom). Drives the
   accent on dashboard cards and calendar blocks.
5. **Calendar Year view** — new "Year" toggle → 12 mini-months; dots colored by
   priority; click a month to zoom in; ←/→ steps by year.
6. **"How'd you hear about us?"** — dropdown (+ "Other" text) on the Register
   form; stored on signup; `GET /api/admin/analytics/referral-sources` for counts.
7. **Hide planned-date when completed** — the translucent planned indicator drops
   off every calendar view once an assignment is graded/submitted.
8. **Schedule / timetable** — new **Schedule** nav page: Mon–Fri × 8am–6pm grid
   from each class's meeting times, colored by class color, conflicts outlined in
   red, days stack on mobile.
9. **Workload prediction** — per-assignment "Estimated hours" (with a heuristic
   suggestion); `GET /api/workload/weekly`; dashboard "Weekly workload" widget
   (this/next week + by-day bar chart); calendar week view shows ~Nh daily totals.
10. **Notes chatbot** — Notes tab → **✨ Chatbot** sub-tab; asks Claude about that
    class's notes only. Needs `ANTHROPIC_API_KEY` (returns a clear message if
    unset or if the class has no notes yet).
11. **Google Calendar sync** — Settings → Preferences → Connect Google Calendar,
    a sync on/off toggle, last-synced, Sync now. One-way push (Summit is source
    of truth); updates/deletes tracked so it never duplicates. **Mock mode is on**
    (`MOCK_GOOGLE_CALENDAR_MODE` via `LMS_MOCK=true`) so it works with no Google
    credentials; the real-API calls are written but unverified.
12. **Files tab** — new **Files** tab per class: drag-drop upload (PDF/Office/
    images/text) with a category, grouped list with size/date, open/preview,
    delete. Stored inline (base64) in `class_files`.
13. **Grade simulator** — "🎯 What if?" on the class page: pick a target (A/B/C/D
    or a %) and see the average needed on remaining work, e.g. "You currently
    have 87%. To get an A (90%), you need to average 93% on the remaining 100 pts."
    Handles already-achieved / impossible / all-graded cases.

## How it was verified (and what's yours to confirm)

The sandbox had **no Postgres and no browser**, and couldn't install packages or
run `vite build` (native binaries are macOS-only). So I verified by: importing the
whole server (catches every route/controller/service wiring error), parsing all 28
client files, and running the LMS pipeline test (`npm run test:lms`, all six
providers pass). Please confirm the live UI and run one real migration + click-through.

Backend feature endpoints exercised by the import check but **not** run against a
real DB: workload, Google Calendar sync, files, grade simulation, notes chatbot,
referral analytics. The grade-sim math matches the spec example; the chatbot and
the real Google Calendar API calls need their respective API keys to run for real.
