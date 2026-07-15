/**
 * Deterministic gap-filling placement for the Schedule day view (Stage 4).
 *
 * Given a day's unscheduled assignments — each with an AI-estimated duration —
 * and its fixed obstacles (class meetings AND already-scheduled assignment
 * blocks), propose a start time for each unscheduled item inside a working
 * window, without overlapping anything.
 *
 * This is PURE, synchronous gap-filling code — NOT an LLM call. The AI already
 * did its job estimating durations; placement is just fitting those blocks into
 * open time. Kept standalone so it's easy to unit-test.
 *
 * Rules:
 *   • place into open gaps only — never overlap a class or an existing block;
 *   • stay inside the working window (default 08:00–22:00);
 *   • snap start times to 15 minutes;
 *   • leave at least a 10-minute buffer AFTER each class block;
 *   • place the longest assignments first (they're the hardest to fit);
 *   • items that can't fit in any gap are returned as `unplaceable`.
 */

export const DAY_WINDOW_START = 8 * 60; // 08:00
export const DAY_WINDOW_END = 22 * 60; // 22:00
const SNAP = 15;
const CLASS_BUFFER = 10;

const snapUp = (min, snap) => Math.ceil(min / snap) * snap;

/**
 * @param {{id:string, durationMin:number}[]} items  unscheduled assignments
 * @param {{startMin:number, endMin:number, isClass?:boolean}[]} obstacles  fixed blocks
 * @param {{windowStart?:number, windowEnd?:number, snap?:number, classBuffer?:number}} [opts]
 * @returns {{ placements: {id:string,startMin:number,durationMin:number}[], unplaceable: string[] }}
 */
export function suggestPlacements(items, obstacles, opts = {}) {
  const windowStart = opts.windowStart ?? DAY_WINDOW_START;
  const windowEnd = opts.windowEnd ?? DAY_WINDOW_END;
  const snap = opts.snap ?? SNAP;
  const classBuffer = opts.classBuffer ?? CLASS_BUFFER;

  // Occupied intervals, clipped to the window. A class block also reserves
  // `classBuffer` minutes after it (transition/settle time).
  const occupied = (obstacles || [])
    .map((o) => {
      const start = o.startMin;
      const end = (o.endMin ?? o.startMin) + (o.isClass ? classBuffer : 0);
      return [Math.max(start, windowStart), Math.min(end, windowEnd)];
    })
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent occupied intervals so gaps are clean.
  const merged = [];
  for (const iv of occupied) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  // Free gaps between occupied intervals within the window.
  const free = [];
  let cursor = windowStart;
  for (const [s, e] of merged) {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < windowEnd) free.push([cursor, windowEnd]);

  // Longest first (hardest to fit); stable tiebreak keeps order deterministic.
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.durationMin || 0) - (a.it.durationMin || 0) || a.i - b.i)
    .map((x) => x.it);

  const placements = [];
  const unplaceable = [];
  for (const item of sorted) {
    const dur = item.durationMin || 0;
    let placed = false;
    for (let g = 0; g < free.length; g++) {
      const [gs, ge] = free[g];
      const start = snapUp(gs, snap);
      if (start + dur <= ge) {
        placements.push({ id: item.id, startMin: start, durationMin: dur });
        // Consume the used span; keep the leftover before/after as free gaps.
        const rest = [];
        if (start > gs) rest.push([gs, start]);
        if (start + dur < ge) rest.push([start + dur, ge]);
        free.splice(g, 1, ...rest);
        placed = true;
        break;
      }
    }
    if (!placed) unplaceable.push(item.id);
  }

  placements.sort((a, b) => a.startMin - b.startMin);
  return { placements, unplaceable };
}
