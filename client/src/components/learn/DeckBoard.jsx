import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { KebabMenu, ConfirmModal } from '../ui';

/**
 * GoodNotes-style hierarchical decks. A clean grid of deck cards (name + count +
 * a mastery progress bar). Click a deck to expand its cards inline below — each
 * card is just its question + a per-card mastery bar + a ⋮ menu (Edit · Delete).
 * Drag a card onto another deck card to move it. Study mode is unchanged.
 */
export function DeckBoard({ decks, cards, onStudy, onEditCard, onChanged, onRenameDeck, flash }) {
  const [expanded, setExpanded] = useState(null); // expanded deck id ('__unsorted' allowed)
  const [dragCardId, setDragCardId] = useState(null);
  const [overDeck, setOverDeck] = useState(null);
  const [confirmCard, setConfirmCard] = useState(null); // card pending delete-confirm
  const [confirmDeck, setConfirmDeck] = useState(null); // deck pending delete-confirm

  // A virtual "Unsorted" deck for cards with no deck, so they're still reachable.
  const unsorted = cards.filter((c) => !c.deckId);
  const items = [
    ...decks.map((d) => ({ ...d, virtual: false })),
    ...(unsorted.length
      ? [{ id: '__unsorted', name: 'Unsorted', virtual: true, cardCount: unsorted.length, ...aggregate(unsorted) }]
      : []),
  ];

  const cardsOf = (deckId) => (deckId === '__unsorted' ? unsorted : cards.filter((c) => c.deckId === deckId));

  const move = async (cardId, deckId) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.deckId === (deckId === '__unsorted' ? null : deckId)) return;
    try {
      await api.patch(`/api/learn/cards/${cardId}`, { deckId: deckId === '__unsorted' ? null : deckId });
      flash('Card moved');
      onChanged();
    } catch (e) { flash(errorMessage(e), 'error'); }
  };

  const doDelete = async () => {
    const card = confirmCard;
    setConfirmCard(null);
    try {
      await api.delete(`/api/learn/cards/${card.id}`);
      flash('Card deleted');
      onChanged();
    } catch (e) { flash(errorMessage(e), 'error'); }
  };

  const doDeleteDeck = async () => {
    const deck = confirmDeck;
    setConfirmDeck(null);
    try {
      await api.delete(`/api/learn/decks/${deck.id}`);
      flash('Deck deleted');
      if (expanded === deck.id) setExpanded(null);
      onChanged();
    } catch (e) { flash(errorMessage(e), 'error'); }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((d) => (
          <DeckCard
            key={d.id}
            deck={d}
            expanded={expanded === d.id}
            dropActive={overDeck === d.id && dragCardId != null}
            onOpen={() => setExpanded((e) => (e === d.id ? null : d.id))}
            onRename={d.virtual ? null : onRenameDeck}
            onDelete={d.virtual ? null : () => setConfirmDeck(d)}
            onDragOver={(e) => { if (dragCardId) { e.preventDefault(); if (overDeck !== d.id) setOverDeck(d.id); } }}
            onDragLeave={() => setOverDeck((o) => (o === d.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); const id = dragCardId || e.dataTransfer.getData('card'); setOverDeck(null); move(id, d.id); }}
          />
        ))}
      </div>

      {/* Inline expansion — the selected deck's cards, below the grid. */}
      {expanded && (
        <div className="mt-4 rounded-2xl border border-white/50 bg-white/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-ink">
              {items.find((d) => d.id === expanded)?.name}
              <span className="ml-2 text-xs font-medium text-muted">{cardsOf(expanded).length} cards</span>
            </h3>
            <button className="btn btn-primary !py-1.5 text-sm" onClick={() => onStudy(expanded === '__unsorted' ? null : expanded)}>
              Study this deck
            </button>
          </div>
          <div className="divide-y divide-white/40">
            {cardsOf(expanded).map((c) => (
              <CardRow
                key={c.id}
                card={c}
                dragging={dragCardId === c.id}
                onDragStart={(e) => { setDragCardId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('card', c.id); }}
                onDragEnd={() => { setDragCardId(null); setOverDeck(null); }}
                onEdit={() => onEditCard(c)}
                onDelete={() => setConfirmCard(c)}
              />
            ))}
            {cardsOf(expanded).length === 0 && <p className="py-4 text-center text-sm text-muted">No cards in this deck.</p>}
          </div>
          {dragCardId && <p className="mt-2 text-center text-[11px] text-muted">Drop a card onto another deck above to move it.</p>}
        </div>
      )}

      {confirmCard && (
        <ConfirmModal
          title="Delete card?"
          message="This permanently deletes the card and its review history. This can’t be undone."
          detail={confirmCard.question}
          onConfirm={doDelete}
          onClose={() => setConfirmCard(null)}
        />
      )}
      {confirmDeck && (
        <ConfirmModal
          title="Delete deck?"
          message={`This removes the deck and its ${confirmDeck.cardCount} card${confirmDeck.cardCount === 1 ? '' : 's'}. This can’t be undone.`}
          detail={confirmDeck.name}
          onConfirm={doDeleteDeck}
          onClose={() => setConfirmDeck(null)}
        />
      )}
    </div>
  );
}

/** Client-side mastery aggregate for the virtual "Unsorted" deck. */
function aggregate(cards) {
  const studied = cards.filter((c) => (c.mastery?.totalReviews ?? 0) > 0).length;
  const avg = cards.length ? Math.round(cards.reduce((s, c) => s + (c.mastery?.masteryPercent ?? 0), 0) / cards.length) : 0;
  return { studiedCount: studied, avgMastery: avg };
}

/* ---- Deck card (grid item, drop target) -------------------------------- */
function DeckCard({ deck, expanded, dropActive, onOpen, onRename, onDelete, onDragOver, onDragLeave, onDrop }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.name);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== deck.name) onRename?.(deck.id, name);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onOpen()}
      onKeyDown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`glass-card relative flex cursor-pointer flex-col p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        expanded ? 'ring-2 ring-brand-400' : ''
      } ${dropActive ? 'ring-2 ring-brand-500 bg-white/70' : ''}`}
    >
      {/* ⋮ menu (real decks only) — Edit renames inline, Delete removes deck + cards. */}
      {onDelete && (
        <div className="absolute right-1.5 top-1.5">
          <KebabMenu
            onEdit={onRename ? () => { setDraft(deck.name); setEditing(true); } : undefined}
            onDelete={onDelete}
          />
        </div>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
          maxLength={120}
          className="w-full rounded-lg border border-brand-300 bg-white/90 px-2 py-1 text-sm font-semibold text-ink outline-none"
        />
      ) : (
        <span className="line-clamp-2 pr-7 font-display text-sm font-bold text-ink">{deck.name}</span>
      )}
      <span className="mt-0.5 text-xs font-medium text-muted">{deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}</span>

      {/* Deck mastery progress + "X of Y studied" */}
      <div className="mt-auto pt-3">
        <ProgressBar percent={deck.avgMastery ?? 0} />
        <div className="mt-1 text-[11px] text-muted">{deck.studiedCount ?? 0} of {deck.cardCount} studied</div>
      </div>
    </div>
  );
}

/* ---- Card row (draggable, question + mastery bar + ⋮ menu) -------------- */
function CardRow({ card, dragging, onDragStart, onDragEnd, onEdit, onDelete }) {
  const pct = card.mastery?.masteryPercent ?? 0;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-3 py-2.5 transition ${dragging ? 'opacity-40' : ''}`}
    >
      <span className="cursor-grab select-none text-muted active:cursor-grabbing" title="Drag to another deck">⠿</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{card.question}</p>
        <div className="mt-1 flex items-center gap-2">
          <ProgressBar percent={pct} className="flex-1" />
          <span className="w-9 shrink-0 text-right text-[11px] font-semibold text-muted">{pct}%</span>
        </div>
      </div>
      <KebabMenu onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function ProgressBar({ percent, className = '' }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-white/55 ${className}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
    </div>
  );
}
