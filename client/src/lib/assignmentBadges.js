/**
 * Shared rules for the small badges on an assignment card/row, so every surface
 * (To-Do board, class board, calendar, dashboard) agrees.
 */

/** True once the work is in the board's Done column. Accepts camelCase (API) or a raw row. */
export const isBoardDone = (a) => (a?.boardStage ?? a?.board_stage) === 'done' || a?.done === true;

/**
 * Whether to show the priority badge. A finished assignment shouldn't keep
 * "yelling" a red HIGH — once it's Done, hide priority entirely (same spirit as
 * the hide-the-time-badge-when-done rule).
 */
export const showPriority = (a) => !isBoardDone(a);

/** A 1h fallback estimate (no instructions to estimate from) — the UI marks it "~". */
export const estimateIsDefault = (a) => (a?.estimateSource ?? a?.estimate_source) === 'default';

/** "~" prefix for a default estimate, "" otherwise — signals it's a soft guess. */
export const estimatePrefix = (a) => (estimateIsDefault(a) ? '~' : '');
