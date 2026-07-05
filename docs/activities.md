# Activities — evidence-based anti-procrastination projects

Activities are **projects for non-class work** — clubs, extracurriculars, freelance,
volunteering. They are a non-academic sibling of `classes`, with dated sub-tasks
(a simplified `assignment`) and a Kanban workflow. The design is grounded in
procrastination research and is meant to be **refined over a year of real use**
(Carolina), so mechanics favor *tunable nudges* over hard rules.

## Research → mechanic

| Finding | Mechanic |
|---|---|
| 70% of college students chronically procrastinate | The whole feature exists to make starting + finishing easier. |
| #1 preventative = breaking work into sub-tasks with intermediate deadlines | Create flow **biases toward breakdown** (3 sub-task rows by default) — but never forces it (see Decision #6). |
| Procrastination ↓ as deadlines approach & are visible | Sub-task due dates show on the calendar + a highlighted **"Next action."** |
| WIP limits prevent context-switch overwhelm (Kanban/GTD) | **Max 3 in-flight activities** (Active + In Progress). Starting a 4th forces pause/finish. |
| Progress visibility → ~30% more completion | **Per-activity progress bar** ("5 of 8 done"). |
| Endowed-progress effect | Breaking it down counts as step 0 → the bar never reads a demotivating 0%. |
| Evaluation anxiety / task aversiveness | Sub-tasks are small + concrete; "Next action" surfaces the single closest step. |

## Locked decisions

1. **WIP scope:** in-flight = **Active + In Progress combined** (3 total).
2. **Kanban columns:** keep all four — **Backlog · Active · In Progress · Done**.
3. **Rescheduling overdue tasks:** **free drag, no friction.**
4. **Auto-complete:** when **all** sub-tasks are done, the activity **auto-moves to Done**.
5. **Google Calendar push:** **app-calendar only** for now (revisit later).
6. **Minimum sub-tasks → Option C (no hard minimum):** a 1-task activity is allowed.
   The create form opens with **3 empty sub-task rows** (default effect) + a soft
   nudge line; you can delete down to 1 and still create. Single-task activities
   get a subtle "+ Add steps" nudge on their card. This keeps the research-backed
   breakdown as the *default path*, never a wall — and it's easy to dial over the year.
   - Sub-task **due dates are optional** (consistent with "not strict"): dated tasks
     appear on the calendar + feed "Next action"; undated tasks are plain checklist
     steps that sort last.

## Data model

**`activities`** — the project container (a non-academic "class")

| column | notes |
|---|---|
| `id, user_id` | owner-scoped |
| `name, description` | |
| `color` | hex, for calendar/Kanban styling (reuses the class-color pattern) |
| `kind` | `club \| extracurricular \| freelance \| volunteer \| other` (future insights) |
| `stage` | `backlog \| active \| in_progress \| done` — the Kanban column / lifecycle |
| `completed_at, archived_at, created_at, updated_at` | |

**`activity_tasks`** — the sub-tasks (a simplified `assignment`)

| column | notes |
|---|---|
| `id, activity_id` | cascade-delete with the activity |
| `title, description` | |
| `due_date` | **optional** (see Decision #6) |
| `planned_date` | for drag-to-reschedule on the calendar |
| `status` | `not_started \| in_progress \| done` |
| `sort_order` | ordering under the activity |
| `completed_at, created_at, updated_at` | |

Reuses existing `dueStatus`/`isDone` helpers for overdue logic and the calendar's
per-container event aggregation (mirrors how class assignments render).

## Backend API

```
GET    /api/activities                 list (+ progress, nextAction, wip counts)
POST   /api/activities                 create activity + tasks (atomic)
GET    /api/activities/:id             detail + tasks
PATCH  /api/activities/:id             rename / recolor / kind
POST   /api/activities/:id/stage       move Kanban column (enforces WIP — Phase B)
DELETE /api/activities/:id             delete
POST   /api/activities/:id/tasks       add a task
PATCH  /api/activities/tasks/:taskId   edit / complete / reschedule (auto-complete check)
DELETE /api/activities/tasks/:taskId   remove
```

Computed on read: `progress = done/total`, `nextAction = earliest-due not-done task`,
`wip = count(stage in ('active','in_progress'))` with the cap = 3.

## Frontend

**UX revision (post-PR-A review):** Activities live **on the Dashboard alongside
classes**, as cards with the *same visual style* — not in a separate section. This
keeps a student's "everything I'm juggling" in one place.

- **`+` dropdown** (Req 0): Dashboard's `+ New class` becomes a balanced **`+`** →
  **Add Class · Add Activity**. "Add Activity" opens the create modal inline on the
  Dashboard.
- **Dashboard cards:** classes + activities render in the **same grid/list**, same
  card look (accent bar, gradient, glass). An activity card swaps the class's
  code/grade for **kind + progress % + "n/m steps" + Next-action countdown** (+ an
  "N overdue" badge). Clicking a **class → `/classes/:id`** (ClassDetailPage);
  clicking an **activity → `/activities/:id`** (ActivityDetailPage).
- **ActivityDetailPage** (`/activities/:id`): activity-specific — name + kind,
  **progress bar** (with "Planned ✓" endowed-progress framing), highlighted
  **Next action**, **stage controls** (Backlog · Active · In Progress · Done), and a
  **steps** editor (check off, add, reschedule via the date field, delete). No
  assignments/grades.
- **Activities Kanban tab → Phase B.** The full Kanban board (Backlog · Active ·
  In Progress · Done) with WIP-guarded drag lives in Phase B, as its own tab.
- **Calendar** (Req 4, Phase C): activity sub-tasks become a **new, visually
  distinct event source** (activities are **status-colored**: Not Started gray →
  In Progress blue → Overdue red → Done green, with an **"X days overdue"** badge),
  vs. classes which are colored *by class*.

## Phasing (PRs)

| PR | Milestone | You can… |
|---|---|---|
| **A** | Data model + create flow (Option C) + `+` dropdown + **Dashboard cards** + ActivityDetailPage | Create broken-down activities; see + open them from the Dashboard |
| **B** | **Activities Kanban tab** + WIP limits + progress / next-action | Work the board; feel the WIP guardrail |
| **C** | Calendar integration (status colors + overdue badge + drag) | See every deadline everywhere |
| **D** *(opt.)* | Insights + Google Calendar push + endowed-progress polish | Refinement fuel from real use |

A → B → C is the usable core; D is refinement.

## Notes for future refinement (the year ahead)
- The Option-C nudge (default row count, copy, card nudge threshold) is designed to
  be a one-line tuning knob — strengthen/relax it as real behavior data comes in.
- `kind` is captured now (even though unused in A) so later **insights** (e.g., which
  activity types you procrastinate on) don't need a backfill.
- WIP cap (3) is a constant; if it turns out too tight/loose, it's a single change.
