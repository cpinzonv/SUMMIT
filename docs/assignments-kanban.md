# Assignments Kanban board

A drag-and-drop workflow board for a class's assignments, living in
**Class detail → Assignments**. It complements (does not replace) the existing
assignments table — a **Table · Board** toggle switches between them. Grounded in
the same WIP-limited Kanban model as the Activities board.

## Locked decisions
1. **View:** Board is a new view *alongside* the table. A toggle in the
   Assignments tab picks Table or Board; both read the same assignments.
2. **Stage vs. status:** the board is driven by a **new `stage`** field
   (`backlog · active · in_progress · done`), independent of the academic
   `status` enum (`not_started · in_progress · submitted · graded`) that feeds
   grades. Dragging changes `stage` only.
3. **WIP limit:** `active + in_progress ≤ 3`. Server-enforced on stage change;
   the blocked 4th shows *"You have 3/3 active. Pause or complete one first."*
4. **Auto-Done:** past-due assignments **stay in place** with a red "N days
   overdue" badge — they do **not** auto-move. Only **Mark complete** (or a drag
   to Done) sets `stage = done`. (Overdue ≠ done.)
5. **Submissions:** the detail view has a **text submission** + **file
   attachments** (reuses the existing file storage, tagged to the assignment).

## Data model (`assignments`, `class_files`)
- `assignments.stage` — enum `assignment_stage ('backlog','active','in_progress','done')`, default `backlog`.
- `assignments.submission_text` — TEXT, the student's typed submission/notes.
- `class_files.assignment_id` — nullable UUID; a file tagged to an assignment is
  a submission (category `submission`). Reuses upload/download/delete as-is.

## API
```
GET   /api/classes/:id/assignments          list (+ stage, submissionText, wip { active, limit })
PATCH /api/assignments/:assignmentId         edit (title/desc/due/…/submissionText)
POST  /api/assignments/:assignmentId/stage   move column { stage } — enforces WIP
GET   /api/assignments/:assignmentId/files   list submission files
POST  /api/classes/:id/files                 upload (now accepts assignmentId + category)
```
`wip.active = count(stage in ('active','in_progress'))`, cap 3. Setting a stage
to `active`/`in_progress` past the cap → 409 with the block message.

## Frontend
- **AssignmentsBoard** — 4 columns; cards show **title · due date · stage badge**
  (overdue = red). Native HTML5 drag-and-drop (no new dependency). The Active
  column header shows `n/3`; a blocked drop shows the WIP toast.
- **AssignmentDetail** (modal on card click) — instructions (description), due
  date, **submission** (textarea + file upload/list), stage controls,
  **Mark complete**, delete.
- **Class → Assignments** gains a **Table · Board** segmented toggle.

## Testing
Create a class with 5+ assignments · drag between columns · try to start a 4th
while 3 are active → blocked · Mark complete → leaves the active columns for Done.
