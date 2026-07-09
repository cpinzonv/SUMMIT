# Assignments Kanban board

A drag-and-drop workflow board for a class's assignments, in **Class detail →
Assignments** (a **Table · Board** toggle switches views).

## Locked decisions
1. **View:** Board alongside the table; a toggle picks Table or Board. Board is the default.
2. **Columns / stage:** three columns — **Planning · In Progress · Done** — driven by
   a `stage` field (`planning · in_progress · done`, default `planning`), independent
   of the academic `status` enum that feeds grades. Dragging changes `stage` only.
3. **No WIP limit.** Cards move freely between columns — no cap, no block, no
   in-flight badge. (An earlier `planning + in_progress ≤ 3` limit was removed.)
4. **Auto-Done:** only on **Mark complete** (or a drag to Done). Past-due cards stay
   in place; the card's due date turns red ("OVERDUE" / "N days late"). Once Done,
   all time indicators are hidden — the card just shows **✓ Done** (board, table,
   and calendar), plus a calm gray "completed N days late" note where late.
5. **Detail status control:** *both* — a **complete toggle** (Mark complete ⇄ Reopen,
   which moves the card to/from Done) **and** an academic **Status** select
   (`Not started · In progress · Submitted · Graded`, feeds grades).
6. **Submissions:** the detail has a **text submission** + **file attachments**
   (reuses class file storage, tagged to the assignment).

## Data model (`assignments`, `class_files`)
- `assignments.stage` — enum `assignment_stage ('planning','in_progress','done')`, default `planning`.
- `assignments.submission_text` — TEXT.
- `class_files.assignment_id` — nullable UUID; a tagged file is a submission (category `submission`).

## API
```
GET   /api/classes/:id/assignments          list (+ stage, submissionText)
PATCH /api/assignments/:assignmentId         edit (…/submissionText/status)
POST  /api/assignments/:assignmentId/stage   move column { stage }
GET   /api/assignments/:assignmentId/files   list submission files
POST  /api/classes/:id/files                 upload (accepts assignmentId + category)
```

## Frontend
- **AssignmentsBoard** — 3 columns; cards show **name · due date** (overdue = red).
  Native HTML5 drag-and-drop (no dependency).
- **AssignmentDetail** (modal) — move-to buttons + Mark-complete/Reopen, Status select,
  due date, instructions, submission (text + file), delete.
- **Class → Assignments** has a **Table · Board** toggle.

## Testing
5+ assignments · drag freely between columns · Mark complete → moves to Done.
