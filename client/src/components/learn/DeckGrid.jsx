import { useEffect, useRef, useState } from 'react';

/**
 * Decks rendered as tactile stacks of flashcards. Tap a stack to open its cards;
 * double-click the name to rename inline. Stack fanning + hover lift live in
 * index.css (.deck-stack*).
 */

function DeckStack({ deck, active, onSelect, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = (e) => {
    e.stopPropagation();
    setDraft(deck.name);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== deck.name) onRename(deck.id, name);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onSelect(deck.id)}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(deck.id);
        }
      }}
      className={`deck-stack ${active ? 'is-active' : ''}`}
      aria-label={`Open ${deck.name} — ${deck.cardCount} cards`}
    >
      <span className="deck-stack-layer deck-stack-layer-3" aria-hidden="true" />
      <span className="deck-stack-layer deck-stack-layer-2" aria-hidden="true" />
      <span className="deck-stack-front glass-card">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setEditing(false); }
            }}
            maxLength={120}
            className="w-full rounded-lg border border-brand-300 bg-white/90 px-2 py-1 text-center text-sm font-semibold text-ink outline-none focus:border-brand-500"
          />
        ) : (
          <span
            className="line-clamp-2 font-display text-sm font-bold text-ink"
            onDoubleClick={startEdit}
            title="Double-click to rename"
          >
            {deck.name}
          </span>
        )}
        <span className="mt-1 text-xs font-medium text-muted">
          {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}
        </span>
      </span>
    </div>
  );
}

export function DeckGrid({ decks, totalCards, activeDeck, onSelect, onRename }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {/* "All cards" — a single flat card (not a stack) so it reads as the "show everything" option. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(null)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(null); } }}
        className={`deck-stack deck-stack--flat ${!activeDeck ? 'is-active' : ''}`}
        aria-label={`All cards — ${totalCards} cards`}
      >
        <span className="deck-stack-front glass-card">
          <span className="font-display text-sm font-bold text-ink">All cards</span>
          <span className="mt-1 text-xs font-medium text-muted">
            {totalCards} card{totalCards === 1 ? '' : 's'}
          </span>
        </span>
      </div>

      {decks.map((d) => (
        <DeckStack key={d.id} deck={d} active={activeDeck === d.id} onSelect={onSelect} onRename={onRename} />
      ))}
    </div>
  );
}
