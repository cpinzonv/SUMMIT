import { useState } from 'react';

/**
 * Reusable Kanban primitive shared by the To-Do board and the per-class boards,
 * so both drag/drop the same way and stay visually consistent. Owns column
 * layout + native HTML5 drag state; the caller supplies the columns, the cards,
 * how to place/identify a card, what happens on move/open, and the card body.
 */
export function StageBoard({ columns, cards, stageOf, cardKey, onMove, onOpen, renderCard }) {
  const [dragKey, setDragKey] = useState(null);
  const [overCol, setOverCol] = useState(null);

  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      {columns.map((col) => {
        const colCards = cards.filter((c) => stageOf(c) === col.key);
        return (
          <section
            key={col.key}
            onDragOver={(e) => { if (dragKey) { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); } }}
            onDragLeave={() => setOverCol((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const k = dragKey || e.dataTransfer.getData('text/plain');
              const card = cards.find((c) => cardKey(c) === k);
              if (card) onMove(card, col.key);
            }}
            className={`flex min-w-[15rem] flex-1 flex-col rounded-2xl border p-2 transition ${
              overCol === col.key && dragKey ? 'border-brand-400 bg-white/60' : 'border-white/40 bg-white/25'
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-2 pt-1">
              <h3 className="text-sm font-bold text-ink">{col.label}</h3>
              <span className="rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-muted">
                {colCards.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {colCards.map((card) => {
                const k = cardKey(card);
                return (
                  <button
                    key={k}
                    type="button"
                    draggable
                    onClick={() => onOpen?.(card)}
                    onDragStart={(e) => {
                      setDragKey(k);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', k);
                    }}
                    onDragEnd={() => { setDragKey(null); setOverCol(null); }}
                    className={`group w-full cursor-grab rounded-xl border border-white/50 bg-white/70 p-3 text-left shadow-sm transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md ${
                      dragKey === k ? 'opacity-40' : ''
                    }`}
                  >
                    {renderCard(card)}
                  </button>
                );
              })}
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
