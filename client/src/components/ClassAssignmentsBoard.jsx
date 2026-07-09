import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { dueStatus } from '../lib/dueDate';
import { estimateLabel } from './AssignmentDetailModal';
import { boardColumns, visibleStage } from '../lib/board';
import { StageBoard } from './StageBoard';

/**
 * Per-class Kanban of this class's assignments, grouped by board_stage. Shares
 * the exact same stage field (and PATCH /api/todo/assignment/:id/stage) as the
 * global To-Do board — a move here is a move there, and vice versa. Columns
 * follow the boardExtraColumns preference, so the Settings toggle affects this
 * board and the To-Do board together.
 */
export function ClassAssignmentsBoard({ assignments, onChanged, onOpen }) {
  const { preferences } = useAuth();
  const [items, setItems] = useState(assignments);
  const [error, setError] = useState('');

  // Re-sync when the parent reloads (e.g. after add/edit/delete).
  useEffect(() => setItems(assignments), [assignments]);

  const move = async (a, stage) => {
    if (a.boardStage === stage) return;
    const prev = a.boardStage;
    setItems((xs) => xs.map((x) => (x.id === a.id ? { ...x, boardStage: stage } : x)));
    try {
      await api.patch(`/api/todo/assignment/${a.id}/stage`, { stage });
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
      setItems((xs) => xs.map((x) => (x.id === a.id ? { ...x, boardStage: prev } : x)));
    }
  };

  const showExtra = !!preferences.boardExtraColumns;
  return (
    <>
      {error && <p className="mb-2 text-sm font-semibold text-rose-600">{error}</p>}
      <StageBoard
        columns={boardColumns(showExtra)}
        cards={items}
        stageOf={(a) => visibleStage(a.boardStage, showExtra)}
        cardKey={(a) => a.id}
        onMove={move}
        onOpen={onOpen}
        renderCard={(a) => <AssignmentCardBody a={a} />}
      />
    </>
  );
}

const PRIORITY_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-sky-400',
  none: 'bg-slate-300',
};

function AssignmentCardBody({ a }) {
  const st = dueStatus(a.dueDate);
  const done = a.boardStage === 'done';
  const showDue = st.hasDue && !done;
  return (
    <div>
      <p className={`text-sm font-semibold ${done ? 'text-muted line-through' : 'text-ink'}`}>{a.title}</p>
      {a.category && <p className="truncate text-[11px] text-muted">{a.category}</p>}
      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[a.priority || 'none']}`} title={`${a.priority || 'none'} priority`} />
        {showDue && (
          <span className={`font-semibold ${st.isPastDue ? 'text-rose-600' : 'text-muted'}`}>
            {st.isPastDue ? st.lateLabel : st.countdownLabel}
          </span>
        )}
        {a.pointValue != null && <span className="text-muted">{a.pointValue} pts</span>}
        {estimateLabel(a.estimatedHours) && (
          <span className="font-semibold text-violet-600">⏱ {estimateLabel(a.estimatedHours)}</span>
        )}
        {done && <span className="font-semibold text-emerald-600">✓ Done</span>}
      </div>
    </div>
  );
}
