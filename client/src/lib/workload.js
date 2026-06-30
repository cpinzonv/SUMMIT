/**
 * Heuristic "estimated hours" suggestion for an assignment, mirroring the
 * server-side fallback (services/workload.service.js). Used to pre-fill / hint
 * the Estimated hours field in the assignment form.
 */
export function suggestHours({ category, title, pointValue } = {}) {
  const text = `${category || ''} ${title || ''}`.toLowerCase();
  const pts = Number(pointValue) || 0;
  const bump = pts >= 100 ? 2 : pts >= 50 ? 1 : 0;
  if (/essay|paper|report|writing/.test(text)) return 3 + bump + (pts >= 100 ? 2 : 0);
  if (/exam|midterm|final|test|quiz/.test(text)) return 2 + bump + (pts >= 100 ? 1 : 0);
  if (/problem set|pset|homework|hw|assignment/.test(text)) return 1 + bump;
  if (/reading|chapter|read/.test(text)) return 1 + (pts >= 50 ? 1 : 0);
  if (/project|lab/.test(text)) return 3 + bump;
  return 2;
}
