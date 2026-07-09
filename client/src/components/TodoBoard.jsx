import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { classGradient, isGlassColor, Spinner, ErrorBanner } from './ui';
import { dueStatus } from '../lib/dueDate';

/**
 * Kanban board for the To-Do tab. Cards are assignments + activity tasks (mixed),
 * grouped by board_stage. Drag a card between columns to change its stage (this
 * shares the /api/todo source of truth with the calendar view). Click a card to
 * open its source (class assignments or the activity).
 */
const COLUMNS = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'planning', label: 'Planning' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export function TodoBoard({ onChange }) {
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null); // `${source}:${id}` being dragged
  const [overCol, setOverCol] = useState(null);

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
    // Optimistic move (Done also flips the done flag, hiding planned indicators).
    setCards((cs) =>
      cs.map((c) =>
        c.id === card.id && c.source === card.source
          ? { ...c, boardStage: stage, done: stage === 'done' }
          : c,
      ),
    );
    try {
      await api.patch(`/api/todo/${card.source}/${card.id}/stage`, { stage });
      onChange?.(); // keep the calendar view in sync
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

  const openCard = (card) =>
    navigate(card.source === 'task' ? `/activities/${card.contextId}` : `/classes/${card.contextId}`);

  if (loading) return <Spinner label="Loading board…" />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
      {COLUMNS.map((col) => {
        const colCards = cards.filter((c) => c.boardStage === col.key);
        return (
          <section
            key={col.key}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); } }}
            onDragLeave={() => setOverCol((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const [source, id] = (dragId || e.dataTransfer.getData('text/plain')).split(':');
              const card = cards.find((c) => c.source === source && c.id === id);
              if (card) move(card, col.key);
            }}
            className={`flex min-w-[15rem] flex-1 flex-col rounded-2xl border p-2 transition ${
              overCol === col.key && dragId ? 'border-brand-400 bg-white/60' : 'border-white/40 bg-white/25'
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <h3 className="text-sm font-bold text-ink">{col.label}</h3>
              <span className="rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-muted">
                {colCards.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {colCards.map((card, i) => (
                <TodoCard
                  key={`${card.source}:${card.id}`}
                  card={card}
                  index={i}
                  dragging={dragId === `${card.source}:${card.id}`}
                  onOpen={() => openCard(card)}
                  onDragStart={(e) => {
                    setDragId(`${card.source}:${card.id}`);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', `${card.source}:${card.id}`);
                  }}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                />
              ))}
              {colCards.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted/70">Drop cards here</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const PRIORITY_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-sky-400',
  none: 'bg-slate-300',
};

function TodoCard({ card, index, dragging, onOpen, onDragStart, onDragEnd }) {
  const gradient = classGradient({ color: card.color }, index);
  const glass = isGlassColor(card.color);
  const st = dueStatus(card.dueDate);
  const showDue = st.hasDue && !card.done;
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`group w-full cursor-grab rounded-xl border border-white/50 bg-white/70 p-3 text-left shadow-sm transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md ${
        dragging ? 'opacity-40' : ''
      }`}
    >
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
            {card.source === 'assignment' && (
              <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[card.priority || 'none']}`} title={`${card.priority || 'none'} priority`} />
            )}
            {showDue && (
              <span className={`font-semibold ${st.isPastDue ? 'text-rose-600' : 'text-muted'}`}>
                {st.isPastDue ? st.lateLabel : st.countdownLabel}
              </span>
            )}
            {card.done && <span className="font-semibold text-emerald-600">✓ Done</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
