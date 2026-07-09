# Assignments Kanban board

A drag-and-drop workflow board for a class's assignments, in **Class detail →
Assignments** (a **Table · Board** toggle switches views). WIP-limited, like the
Activities board.

## Locked decisions
1. **View:** Board alongside the table; a toggle picks Table or Board. Board is the default.
2. **Columns / stage:** three columns — **Planning · In Progress · Done** — driven by
   a `stage` field (`planning · in_progress · done`, default `planning`), independent
   of the academic `status` enum that feeds grades. Dragging changes `stage` only.
3. **WIP limit:** `planning + in_progress ≤ 3` (both non-Done columns count).
   Server-enforced on stage change into an in-flight column; the blocked move shows
   *"You have 3/3 active. Pause or complete one first."* + an in-flight badge.
4. **Auto-Done:** only on **Mark complete** (or a drag to Done). Past-due cards stay
   in place; the card's due date turns red ("OVERDUE" / "N days late").
5. **Detail status control:** *both* — a **complete toggle** (Mark complete ⇄ Reopen,
   which moves the card to/from Done) **and** an academic **Status** select
   (`Not started · In progress · Submitted · Graded`, feeds grades).
6. **Submissions:** the detail has a **text submission** + **file attachments**
   (reuses class file storage, tagged to the assignment).

> **Note — no Backlog column.** New assignments default to `planning`, which counts
> toward WIP. A brand-new class with many assignments therefore starts *over* the
> in-flight limit (a "you're over-committed" signal); the hard block then prevents
> pulling *more* cards into the active columns. Re-adding an uncounted inbox column
> is the alternative if that's not wanted.

## Data model (`assignments`, `class_files`)
- `assignments.stage` — enum `assignment_stage ('planning','in_progress','done')`, default `planning`.
- `assignments.submission_text` — TEXT.
- `class_files.assignment_id` — nullable UUID; a tagged file is a submission (category `submission`).

## API
```
GET   /api/classes/:id/assignments          list (+ stage, submissionText)
PATCH /api/assignments/:assignmentId         edit (…/submissionText/status)
POST  /api/assignments/:assignmentId/stage   move column { stage } — enforces WIP
GET   /api/assignments/:assignmentId/files   list submission files
POST  /api/classes/:id/files                 upload (accepts assignmentId + category)
```

## Frontend
- **AssignmentsBoard** — 3 columns; cards show **name · due date** (overdue = red).
  Native HTML5 drag-and-drop (no dependency). Board header shows `n/3 in flight`.
- **AssignmentDetail** (modal) — move-to buttons + Mark-complete/Reopen, Status select,
  due date, instructions, submission (text + file), delete.
- **Class → Assignments** has a **Table · Board** toggle.

## Testing
5+ assignments · drag between columns · try to activate a 4th while 3 in-flight →
blocked · Mark complete → moves to Done.
