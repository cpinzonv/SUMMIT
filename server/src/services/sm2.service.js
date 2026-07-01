/**
 * Classic SM-2 (Woźniak, 1990). Pure function — no I/O.
 * Rating scale 1–5 (1 = hard/fail … 5 = easy). A rating < 3 fails the card.
 */

const MIN_EF = 1.3;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p
 * @param {number} p.rating          1–5
 * @param {number} [p.easeFactor=2.5] current EF
 * @param {number} [p.interval=0]     current interval in days
 * @param {number} [p.repetitions=0]  successful reps in a row
 * @returns {{ easeFactor, interval, repetitions, shouldShowAgainToday }}
 */
export function sm2({ rating, easeFactor = 2.5, interval = 0, repetitions = 0 }) {
  const q = Math.max(1, Math.min(5, Math.round(rating)));

  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), floored at 1.3.
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const nextEf = Math.max(MIN_EF, round2((easeFactor || 2.5) + delta));

  if (q >= 3) {
    const reps = repetitions + 1;
    let ivl;
    if (reps === 1) ivl = 1;
    else if (reps === 2) ivl = 3;
    else ivl = Math.max(1, Math.round((interval || 1) * nextEf));
    return { easeFactor: nextEf, interval: ivl, repetitions: reps, shouldShowAgainToday: false };
  }

  // Fail → reset the streak; the card comes back today/next session.
  return { easeFactor: nextEf, interval: 0, repetitions: 0, shouldShowAgainToday: true };
}
