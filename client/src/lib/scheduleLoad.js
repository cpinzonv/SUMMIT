/**
 * Per-day workload for the Schedule week grid.
 *
 * A day's load is the sum of the estimated durations of the assignments the
 * student is expected to work on that day. This is a SEPARATE surface from the
 * Dashboard workload-prediction widget (server /api/workload) — same spirit
 * (estimated hours, done excluded), but this one is per-day and layers in
 * `scheduled_time` (time-blocking). It does not change the widget.
 *
 * Kept out of the component so Stage 3 (drag-to-schedule day view) can reuse it.
 */

/** Round to the nearest half hour (chips read "5h", "2.5h"). */
export const roundHalf = (h) => Math.round((Number(h) || 0) * 2) / 2;

/** Compact hours label: 5 → "5h", 2.5 → "2.5h". */
export const hoursLabel = (h) => {
  const n = roundHalf(h);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
};

/**
 * A card's effective day = when the work happens. `scheduled_time` (an explicit
 * time-block) wins; otherwise the planning hint `planned_date`; otherwise the
 * deadline `due_date`. This mirrors the widget's planned/due precedence, with
 * scheduled_time layered on top. Returns a Date, or null when the card has none.
 */
export function effectiveDate(card) {
  const iso = card?.scheduledTime || card?.plannedDate || card?.dueDate || null;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Group To-Do feed cards into per-day workload buckets. A card contributes when:
 *   • it has an estimated duration (`estimatedHours != null`) — tasks and
 *     un-estimated assignments carry no time to block, so they don't count;
 *   • it is not done (`boardStage !== 'done' && !done`);
 *   • its owning context is active (`contextId` in `activeClassIds`, when given);
 *   • its effective date resolves.
 *
 * Returns Map<'YYYY-MM-DD', { hours, items }> where `hours` is rounded to the
 * nearest half and `items` are the contributing cards (for the popover), sorted
 * by estimated hours descending.
 */
export function dayLoads(cards, { activeClassIds = null } = {}) {
  const map = new Map();
  for (const card of cards || []) {
    if (card.done || card.boardStage === 'done') continue;
    if (card.estimatedHours == null) continue;
    if (activeClassIds && !activeClassIds.has(card.contextId)) continue;
    const d = effectiveDate(card);
    if (!d) continue;
    const key = localKey(d);
    if (!map.has(key)) map.set(key, { raw: 0, items: [] });
    const bucket = map.get(key);
    bucket.raw += Number(card.estimatedHours) || 0;
    bucket.items.push(card);
  }
  for (const bucket of map.values()) {
    bucket.hours = roundHalf(bucket.raw);
    bucket.items.sort((a, b) => (b.estimatedHours || 0) - (a.estimatedHours || 0));
    delete bucket.raw;
  }
  return map;
}
