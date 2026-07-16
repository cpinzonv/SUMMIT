import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { classGradient, isGlassColor, Spinner, ErrorBanner } from './ui';
import { dueStatus } from '../lib/dueDate';
import { boardColumns, visibleStage } from '../lib/board';
import { showPriority, estimatePrefix } from '../lib/assignmentBadges';
import { StageBoard } from './StageBoard';
import { AssignmentDetailModal, estimateLabel } from './AssignmentDetailModal';

/**
 * To-Do board — assignments + activity tasks (mixed), grouped by board_stage.
 * Shares the /api/todo source of truth with the calendar view AND the per-class
 * boards (both write assignment.board_stage). Columns follow the user's
 * boardExtraColumns preference. Click a card to open its class or activity.
 */
export function TodoBoard({ onChange }) {
  const navigate = useNavigate();
  const { preferences } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openAssignment, setOpenAssignment] = useState(null); // assignment card opened in the detail modal

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/todo');
      setCards(data.cards);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (card, stage) => {
    if (card.boardStage === stage) return;
    const prev = card.boardStage;
    setCards((cs) =>
      cs.map((c) =>
        c.id === card.id && c.source === card.source
          ? { ...c, boardStage: stage, done: stage === 'done' }
          : c,
      ),
    );
    try {
      await api.patch(`/api/todo/${card.source}/${card.id}/stage`, { stage });
      onChange?.();
    } catch (err) {
      setError(errorMessage(err));
      setCards((cs) =>
        cs.map((c) =>
          c.id === card.id && c.source === card.source
            ? { ...c, boardStage: prev, done: prev === 'done' }
            : c,
        ),
      );
    }
  };

  // Assignments open the rich detail modal in place; activity tasks still deep-link.
  const openCard = (card) => {
    if (card.source === 'assignment') {
      setOpenAssignment({
        id: card.id,
        title: card.title,
        dueDate: card.dueDate,
        boardStage: card.boardStage,
        priority: card.priority,
        estimatedHours: card.estimatedHours ?? null,
      });
    } else {
      navigate(`/activities/${card.contextId}`);
    }
  };

  if (loading) return <Spinner label="Loading board…" />;
  if (error) return <ErrorBanner message={error} />;

  const showExtra = !!preferences.boardExtraColumns;
  return (
    <>
      <StageBoard
        columns={boardColumns(showExtra)}
        cards={cards}
        stageOf={(c) => visibleStage(c.boardStage, showExtra)}
        cardKey={(c) => `${c.source}:${c.id}`}
        onMove={move}
        onOpen={openCard}
        renderCard={(c) => <TodoCardBody card={c} />}
      />
      {openAssignment && (
        <AssignmentDetailModal
          assignment={openAssignment}
          onClose={() => setOpenAssignment(null)}
          onChanged={() => { load(); onChange?.(); }}
        />
      )}
    </>
  );
}

const PRIORITY_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-sky-400',
  none: 'bg-slate-300',
};

function TodoCardBody({ card }) {
  const gradient = classGradient({ color: card.color }, 0);
  const glass = isGlassColor(card.color);
  const st = dueStatus(card.dueDate);
  const showDue = st.hasDue && !card.done;
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={glass ? { background: 'rgba(148,163,184,0.5)' } : { backgroundImage: gradient }}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${card.done ? 'text-muted line-through' : 'text-ink'}`}>
          {card.title}
        </p>
        <p className="truncate text-[11px] text-muted">
          {card.source === 'task' ? '◇ ' : ''}{card.contextName}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {card.source === 'assignment' && showPriority(card) && (
            <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[card.priority || 'none']}`} title={`${card.priority || 'none'} priority`} />
          )}
          {showDue && (
            <span className={`font-semibold ${st.isPastDue ? 'text-rose-600' : 'text-muted'}`}>
              {st.isPastDue ? st.lateLabel : st.countdownLabel}
            </span>
          )}
          {card.source === 'assignment' && estimateLabel(card.estimatedHours) && !card.done && (
            <span className="font-semibold text-violet-600">⏱ {estimatePrefix(card)}{estimateLabel(card.estimatedHours)}</span>
          )}
          {card.done && <span className="font-semibold text-emerald-600">✓ Done</span>}
        </div>
      </div>
    </div>
  );
}
