/**
 * Shared due-date math for past-due indicators and the days-left countdown.
 *
 * Everything is by CALENDAR DAY (local midnight), so the badge reads the way a
 * student thinks about a deadline rather than by the exact clock time:
 *   • due today  (daysLeft === 0) → "Due today"     — NOT late, even if the
 *                                                      clock time has passed
 *   • due future (daysLeft  >  0) → "N day(s) left"
 *   • due past   (daysLeft  <  0) → "N day(s) late"
 * Computed at render time, so the counters advance on their own each day.
 */
const MS_DAY = 24 * 60 * 60 * 1000;

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

export function dueStatus(dueDate, now = new Date()) {
  if (!dueDate) {
    return { hasDue: false, isPastDue: false, daysLeft: null, daysOverdue: 0, countdownLabel: null, lateLabel: null };
  }
  const due = new Date(dueDate);
  const daysLeft = Math.round((midnight(due) - midnight(now)) / MS_DAY);
  // Overdue only once the due DAY has fully passed — the day it's due it reads
  // "Due today", not late.
  const isPastDue = daysLeft < 0;
  const daysOverdue = isPastDue ? -daysLeft : 0;

  let countdownLabel;
  if (daysLeft < 0) countdownLabel = `${days(daysOverdue)} late`;
  else if (daysLeft === 0) countdownLabel = 'Due today';
  else countdownLabel = `${days(daysLeft)} left`;

  const lateLabel = isPastDue ? `${days(daysOverdue)} late` : null;

  return { hasDue: true, isPastDue, daysLeft, daysOverdue, countdownLabel, lateLabel };
}

/** An assignment counts as "done" (no longer overdue/needs-doing) when it's in the
 *  board's Done column, submitted, graded, or already has a grade. Used by the
 *  past-due badge + planned-date features. */
export function isDone(assignment) {
  return (
    assignment?.boardStage === 'done' || // moved to Done on the Kanban board
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
