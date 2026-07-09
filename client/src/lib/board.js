/**
 * Shared Kanban column config for BOTH the global To-Do board and the per-class
 * assignment boards, so they always agree.
 *
 * Default columns: Not Started · In Progress · Done. Backlog + Planning are
 * optional (the `boardExtraColumns` user preference) and sort before Not Started.
 * When the extras are hidden, any card still parked in Backlog/Planning collapses
 * into the Not Started column so nothing ever disappears.
 */
export const ALL_STAGES = [
  { key: 'backlog', label: 'Backlog', extra: true },
  { key: 'planning', label: 'Planning', extra: true },
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

/** The columns to render, given the user's "show extra columns" preference. */
export function boardColumns(showExtra) {
  return showExtra ? ALL_STAGES : ALL_STAGES.filter((s) => !s.extra);
}

/**
 * Which visible column a card belongs in. With extras hidden, Backlog/Planning
 * fold into Not Started.
 */
export function visibleStage(stage, showExtra) {
  if (showExtra) return stage || 'not_started';
  if (stage === 'backlog' || stage === 'planning') return 'not_started';
  return stage || 'not_started';
}
