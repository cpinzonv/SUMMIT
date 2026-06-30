/**
 * Shared due-date math for past-due indicators and the days-left countdown.
 *
 * Uses calendar-day boundaries (local midnight) for the day counts so "due later
 * today" reads as "Due today" and "due yesterday" reads as "1 day late", while
 * `isPastDue` uses the exact timestamp (a deadline that passed an hour ago is
 * already overdue). Everything is computed at render time, so the counters
 * advance on their own each day with no stored state.
 */
const MS_DAY = 24 * 60 * 60 * 1000;

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dueStatus(dueDate, now = new Date()) {
  if (!dueDate) {
    return { hasDue: false, isPastDue: false, daysLeft: null, daysOverdue: 0, countdownLabel: null, lateLabel: null };
  }
  const due = new Date(dueDate);
  const daysLeft = Math.round((midnight(due) - midnight(now)) / MS_DAY);
  const isPastDue = due.getTime() < now.getTime();
  const daysOverdue = isPastDue ? Math.max(1, Math.round((midnight(now) - midnight(due)) / MS_DAY)) : 0;

  let countdownLabel;
  if (isPastDue) countdownLabel = 'OVERDUE';
  else if (daysLeft <= 0) countdownLabel = 'Due today';
  else if (daysLeft === 1) countdownLabel = 'Due tomorrow';
  else countdownLabel = `${daysLeft} days left`;

  // Badge text for the past-due warning: "OVERDUE" the day of, else "N days late".
  const lateLabel = isPastDue ? (daysOverdue <= 0 ? 'OVERDUE' : `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} late`) : null;

  return { hasDue: true, isPastDue, daysLeft, daysOverdue, countdownLabel, lateLabel };
}

/** An assignment counts as "done" (no longer overdue/needs-doing) when submitted,
 *  graded, or it already has a grade. Used by past-due + planned-date features. */
export function isDone(assignment) {
  return (
    assignment?.status === 'submitted' ||
    assignment?.status === 'graded' ||
    assignment?.status === 'completed' ||
    Boolean(assignment?.grade)
  );
}

/** Tailwind classes for the days-left countdown text, by urgency. */
export function countdownTone(status) {
  if (!status?.hasDue) return 'text-muted';
  if (status.isPastDue) return 'text-rose-600';
  if (status.daysLeft <= 1) return 'text-orange-500';
  if (status.daysLeft <= 3) return 'text-amber-600';
  return 'text-muted';
}
