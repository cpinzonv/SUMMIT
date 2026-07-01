import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Modal, Spinner, ErrorBanner, EmptyState, Toggle } from '../ui';
import { Labeled } from './common';
import { exportDeck } from '../../lib/learnExport';
import { CardFace, CardTypeBadge } from './CardTypes';
import { LearnEmptyState } from './LearnEmptyState';
import DeckCompletionAnimation from './DeckCompletionAnimation';

/** Flashcards: manage a class's cards and run spaced-repetition review sessions. */

const MASTERY = {
  new: { label: 'New', cls: 'bg-slate-400/15 text-slate-500' },
  learning: { label: 'Learning', cls: 'bg-amber-400/15 text-amber-600' },
  review: { label: 'Review', cls: 'bg-sky-400/15 text-sky-600' },
  mastered: { label: 'Mastered', cls: 'bg-emerald-400/15 text-emerald-600' },
};
const DIFFICULTY = { easy: 'text-emerald-500', medium: 'text-amber-500', hard: 'text-rose-500' };
// Classic SM-2 5-button rating: 1=Again … 5=Easy. Ratings < 3 fail the card.
const RATINGS = [
  { v: 1, label: 'Again', cls: 'border-rose-300 text-rose-600 hover:bg-rose-50' },
  { v: 2, label: 'Hard', cls: 'border-orange-300 text-orange-600 hover:bg-orange-50' },
  { v: 3, label: 'OK', cls: 'border-amber-300 text-amber-600 hover:bg-amber-50' },
  { v: 4, label: 'Good', cls: 'border-sky-300 text-sky-600 hover:bg-sky-50' },
  { v: 5, label: 'Easy', cls: 'border-emerald-300 text-emerald-600 hover:bg-emerald-50' },
];

// Fisher–Yates shuffle (used when interleaving is on).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PHASE_LABEL = { learning: 'Learning', review: 'Review', relearning: 'Relearning' };
function PhaseBadge({ phase, step }) {
  if (!phase) return null;
  return (
    <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold text-brand-700">
      {PHASE_LABEL[phase] || phase}{(phase === 'learning' || phase === 'relearning') && step != null ? ` · step ${step + 1}` : ''}
    </span>
  );
}

// Classic SM-2: a card is studyable when it's new (no next_review_date yet) or
// its scheduled review date has arrived — and it isn't suspended/buried.
const isDue = (card) =>
  !card.isSuspended &&
  (!card.buryUntil || new Date(card.buryUntil) <= new Date()) &&
  (!card.nextReviewDate || new Date(card.nextReviewDate) <= new Date());

export function FlashcardsTab({ classId, className, refreshStats, flash }) {
  const [cards, setCards] = useState([]);
  const [decks, setDecks] = useState([]);
  const [activeDeck, setActiveDeck] = useState(null); // null = all decks
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [editorCard, setEditorCard] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [generating, setGenerating] = useState(false);
  const [studyToken, setStudyToken] = useState(0); // bump to refresh the deck panel

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cardsRes, decksRes] = await Promise.all([
        api.get(`/api/learn/classes/${classId}/cards`),
        api.get(`/api/learn/classes/${classId}/decks`),
      ]);
      setCards(cardsRes.data.cards);
      setDecks(decksRes.data.decks);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const afterChange = useCallback(() => {
    load();
    refreshStats?.();
    setStudyToken((t) => t + 1);
  }, [load, refreshStats]);

  // Scope the grid + "Study" to the selected deck (null = all cards).
  const shownCards = activeDeck ? cards.filter((c) => c.deckId === activeDeck) : cards;
  const dueCount = shownCards.filter(isDue).length;
  const activeDeckName = activeDeck ? decks.find((d) => d.id === activeDeck)?.name : null;

  if (loading) return <Spinner label="Loading cards…" />;

  return (
    <div className="space-y-4">
      {/* Toolbar only when there are cards — otherwise the empty-state hero carries the CTAs. */}
      {cards.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={dueCount === 0}
            onClick={() => setReviewing(true)}
            title={dueCount === 0 ? 'Nothing due right now' : undefined}
          >
            {activeDeckName ? `Study this deck (${dueCount})` : `Study due (${dueCount})`}
          </button>
          <button className="btn btn-soft" onClick={() => setGenerating(true)}>✦ Generate with AI</button>
          <button className="btn btn-soft" onClick={() => setEditorCard(null)}>+ Add card</button>
          <details className="relative">
            <summary className="btn btn-soft cursor-pointer list-none">⬇ Export</summary>
            <div className="glass-panel absolute right-0 z-10 mt-1 w-44 p-1 text-sm">
              <button className="menu-item" onClick={() => exportDeck(shownCards, className, 'tsv')}>Anki deck (.txt)</button>
              <button className="menu-item" onClick={() => exportDeck(shownCards, className, 'csv')}>CSV spreadsheet</button>
            </div>
          </details>
        </div>
      )}

      {/* Deck selector — group cards by source note (Anki-style). */}
      {decks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <DeckChip label="All cards" count={cards.length} active={!activeDeck} onClick={() => setActiveDeck(null)} />
          {decks.map((d) => (
            <DeckChip
              key={d.id}
              label={d.name}
              count={d.cardCount}
              active={activeDeck === d.id}
              onClick={() => setActiveDeck(d.id)}
            />
          ))}
        </div>
      )}

      {/* Per-deck study plan: progress, deadline, daily limits, interleaving. */}
      {activeDeck && (
        <DeckStudyPanel deckId={activeDeck} token={studyToken} flash={flash} />
      )}

      {error && <ErrorBanner message={error} />}

      {cards.length === 0 ? (
        <LearnEmptyState
          className={className}
          onGenerate={() => setGenerating(true)}
          onAddManual={() => setEditorCard(null)}
        />
      ) : shownCards.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted">No cards in this deck yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shownCards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              onEdit={() => setEditorCard(card)}
              onDelete={async () => {
                if (!confirm('Delete this card?')) return;
                try {
                  await api.delete(`/api/learn/cards/${card.id}`);
                  flash('Card deleted');
                  afterChange();
                } catch (err) {
                  flash(errorMessage(err), 'error');
                }
              }}
            />
          ))}
        </div>
      )}

      {editorCard !== undefined && (
        <CardEditorModal
          classId={classId}
          card={editorCard}
          onClose={() => setEditorCard(undefined)}
          onSaved={(msg) => { setEditorCard(undefined); flash(msg); afterChange(); }}
        />
      )}
      {generating && (
        <GenerateModal
          classId={classId}
          onClose={() => setGenerating(false)}
          onGenerated={(n) => { setGenerating(false); flash(`Generated ${n} card${n === 1 ? '' : 's'}`); afterChange(); }}
        />
      )}
      {reviewing && (
        <ReviewSession
          classId={classId}
          deckId={activeDeck}
          deckName={activeDeckName}
          cards={shownCards}
          className={className}
          flash={flash}
          onClose={() => { setReviewing(false); afterChange(); }}
        />
      )}
    </div>
  );
}

/** Selectable deck pill with a card count. */
function DeckChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition ${
        active ? 'bg-white/80 text-brand-700 shadow-sm' : 'bg-white/45 text-muted hover:bg-white/70 hover:text-ink'
      }`}
    >
      <span className="max-w-[12rem] truncate">{label}</span>
      <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-brand-500/15 text-brand-700' : 'bg-black/5 text-muted'}`}>{count}</span>
    </button>
  );
}

function CardTile({ card, onEdit, onDelete }) {
  const [flipped, setFlipped] = useState(false);
  const m = MASTERY[card.mastery?.status || 'new'];
  const pct = card.mastery?.masteryPercent ?? 0;
  return (
    <div className="glass-panel flex flex-col gap-2 p-4" onDoubleClick={onEdit} title="Double-click to edit">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.cls}`}>{m.label}</span>
          <CardTypeBadge type={card.cardType} />
        </span>
        <div className="flex items-center gap-1 text-xs">
          <span className={`mr-1 font-bold uppercase ${DIFFICULTY[card.difficulty]}`}>{card.difficulty}</span>
          <button onClick={onEdit} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/50 hover:text-ink" aria-label="Edit card">✎</button>
          <button onClick={onDelete} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/50 hover:text-rose-500" aria-label="Delete card">🗑</button>
        </div>
      </div>
      <button onClick={() => setFlipped((f) => !f)} className="flex max-h-[300px] w-full flex-col overflow-hidden text-left text-sm">
        <CardFace card={card} revealed={flipped} preview />
        {!flipped && <p className="mt-1 text-xs text-muted/70">Click to reveal</p>}
      </button>
      {card.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="rounded-full bg-white/50 px-2 py-0.5 text-[10px] font-medium text-muted">#{t}</span>
          ))}
        </div>
      )}
      <div className="mt-auto h-1.5 overflow-hidden rounded-full bg-white/40">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--grad-teal-purple)' }} />
      </div>
    </div>
  );
}

function CardEditorModal({ classId, card, onClose, onSaved }) {
  const editing = Boolean(card);
  // Card type can only be chosen on create (editing keeps the existing type).
  const [cardType, setCardType] = useState(card?.cardType || 'basic');
  const [form, setForm] = useState({
    question: card?.question || '',
    answer: card?.answer || '',
    explanation: card?.explanation || '',
    difficulty: card?.difficulty || 'medium',
    tags: (card?.tags || []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const upd = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));

  const isCloze = cardType === 'cloze';
  const isMath = cardType === 'math';
  const needsAnswer = cardType === 'basic' || cardType === 'math';
  const qLabel = isCloze ? 'Cloze text — wrap blanks like {{c1::answer}}' : isMath ? 'Question (use $$LaTeX$$)' : 'Question';

  const save = async () => {
    setSaving(true);
    setErr('');
    const payload = {
      question: form.question.trim(),
      answer: form.answer.trim() || undefined,
      explanation: form.explanation.trim() || undefined,
      difficulty: form.difficulty,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
      ...(editing ? {} : { cardType, ...(isMath ? { latexContent: form.answer.trim() || form.question.trim() } : {}) }),
    };
    try {
      if (editing) await api.patch(`/api/learn/cards/${card.id}`, payload);
      else await api.post(`/api/learn/classes/${classId}/cards`, payload);
      onSaved(editing ? 'Card updated' : 'Card added');
    } catch (e) {
      setErr(errorMessage(e));
      setSaving(false);
    }
  };

  const canSave = form.question.trim() && (!needsAnswer || form.answer.trim());

  return (
    <Modal title={editing ? 'Edit card' : 'New card'} onClose={onClose} wide>
      <div className="space-y-3">
        {err && <ErrorBanner message={err} />}
        {!editing && (
          <Labeled label="Card type">
            <select className="field" value={cardType} onChange={(e) => setCardType(e.target.value)}>
              <option value="basic">Basic (Q&amp;A)</option>
              <option value="cloze">Cloze deletion</option>
              <option value="math">Math (LaTeX)</option>
            </select>
          </Labeled>
        )}
        <Labeled label={qLabel}>
          <textarea className="field min-h-[3rem]" value={form.question} onChange={upd('question')} autoFocus
            placeholder={isCloze ? 'The {{c1::mitochondria}} is the powerhouse of the cell' : isMath ? 'Solve $$\\int x^2 dx$$' : ''} />
        </Labeled>
        {needsAnswer && (
          <Labeled label={isMath ? 'Answer (use $$LaTeX$$)' : 'Answer'}>
            <textarea className="field min-h-[3rem]" value={form.answer} onChange={upd('answer')}
              placeholder={isMath ? '$$\\frac{x^3}{3} + C$$' : ''} />
          </Labeled>
        )}
        <Labeled label="Explanation (optional)"><textarea className="field min-h-[2.5rem]" value={form.explanation} onChange={upd('explanation')} /></Labeled>
        <div className="flex gap-3">
          <Labeled label="Difficulty">
            <select className="field" value={form.difficulty} onChange={upd('difficulty')}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
          </Labeled>
          <Labeled label="Tags (comma-separated)">
            <input className="field" value={form.tags} onChange={upd('tags')} placeholder="vocabulary, formula" />
          </Labeled>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !canSave} onClick={save}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add card'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const CARD_STYLES = [
  { value: 'default', label: 'Default' },
  { value: 'occlusion', label: 'Occlusion' },
  { value: 'cloze', label: 'Cloze' },
  { value: 'qa', label: 'Q&A' },
];

function GenerateModal({ classId, onClose, onGenerated }) {
  const [notes, setNotes] = useState(null); // null = loading
  const [selected, setSelected] = useState(() => new Set());
  const [style, setStyle] = useState('default');
  const [quantity, setQuantity] = useState(20);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load this class's notes so the user can pick which to generate from.
  useEffect(() => {
    let active = true;
    api
      .get(`/api/classes/${classId}/notes`)
      .then(({ data }) => {
        if (!active) return;
        setNotes(data.notes);
        setSelected(new Set(data.notes.map((n) => n.id))); // all on by default
      })
      .catch(() => active && setNotes([]));
    return () => {
      active = false;
    };
  }, [classId]);

  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = notes && notes.length > 0 && selected.size === notes.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(notes.map((n) => n.id)));

  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data } = await api.post(`/api/learn/classes/${classId}/generate`, {
        // count drives generation today; style + notes are passed for the
        // backend to honor later (currently ignored server-side).
        count: Number(quantity),
        quantity: Number(quantity),
        style,
        notes: [...selected],
      });
      onGenerated(data.cards.length);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Generate flashcards with AI" onClose={onClose}>
      <div className="space-y-4">
        {err && <ErrorBanner message={err} />}
        <p className="text-sm text-muted">Choose what to study from and how the cards should look.</p>

        {/* Which notes */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Notes to include</span>
            {notes?.length > 0 && (
              <button type="button" onClick={toggleAll} className="text-xs font-semibold text-brand-600 hover:underline">
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          {notes === null ? (
            <p className="text-sm text-muted">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="rounded-xl border border-white/60 bg-white/40 px-3 py-2 text-sm text-muted">
              No notes yet — Claude will use this class's transcripts.
            </p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-white/60 bg-white/40 p-1.5">
              {notes.map((n) => (
                <label key={n.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/60">
                  <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} className="h-4 w-4 accent-brand-500" />
                  <span className="truncate text-ink">{n.title?.trim() || 'Untitled note'}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Card style */}
        <Labeled label="Card style">
          <select className="field" value={style} onChange={(e) => setStyle(e.target.value)}>
            {CARD_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Labeled>

        {/* Quantity slider */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Number of cards</span>
            <span className="text-sm font-bold text-brand-600">{quantity}</span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full accent-brand-500"
            aria-label="Number of cards to generate"
          />
          <div className="mt-0.5 flex justify-between text-[11px] text-muted">
            <span>5</span>
            <span>100</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Generating…' : 'Generate'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Top-right 3-dot menu on the study card: delete / bury / suspend. */
function StudyCardMenu({ onAction, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (type) => { setOpen(false); onAction(type); };

  const items = [
    { type: 'delete', label: 'Delete', cls: 'text-rose-600 hover:bg-rose-50', icon: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /> },
    { type: 'bury', label: 'Bury', cls: 'text-orange-600 hover:bg-orange-50', icon: <path d="M12 5v13M6 12l6 6 6-6" /> },
    { type: 'suspend', label: 'Suspend', cls: 'text-amber-500 hover:bg-amber-50', icon: <><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></> },
  ];

  return (
    <div ref={ref} className="absolute right-4 top-4 z-10">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-full bg-white/60 text-muted backdrop-blur transition hover:bg-white/90 hover:text-ink disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="glass-panel absolute right-0 mt-1 w-40 overflow-hidden p-1 text-sm shadow-lg">
          {items.map((it) => (
            <button
              key={it.type}
              role="menuitem"
              onClick={() => pick(it.type)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-semibold transition ${it.cls}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {it.icon}
              </svg>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-deck study plan: progress, deadline, daily limits, interleaving toggle. */
function DeckStudyPanel({ deckId, token, flash }) {
  const [plan, setPlan] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editingDeadline, setEditingDeadline] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api.get(`/api/decks/${deckId}/study-plan`),
        api.get(`/api/decks/${deckId}/settings`),
      ]);
      setPlan(p.data);
      setSettings(s.data);
    } catch { /* non-fatal — panel just stays hidden */ }
  }, [deckId]);

  useEffect(() => { load(); }, [load, token]);

  if (!plan || !settings) return null;
  const { deck, deadline, daysRemaining, plan: proj, today } = plan;

  const toggleInterleaving = async () => {
    const next = !settings.interleavingEnabled;
    setSettings((s) => ({ ...s, interleavingEnabled: next }));
    try {
      await api.post(`/api/decks/${deckId}/settings`, { interleavingEnabled: next });
    } catch { load(); }
  };

  return (
    <div className="glass-panel space-y-3 p-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-semibold text-ink">
            {deck.cardsLearned} / {deck.totalCards} cards learned
          </span>
          <span className="text-muted">{deck.progressPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/50">
          <div className="h-full rounded-full transition-all" style={{ width: `${deck.progressPercent}%`, backgroundImage: 'var(--grad-teal-purple)' }} />
        </div>
      </div>

      <p className="text-xs text-muted">
        Today: {today.newCardsToday} new + {today.cardsReviewedToday} reviews ={' '}
        {today.totalInteractionsToday} interactions ({today.totalInteractionsToday}/{settings.userDailyStudyLimit} used)
      </p>

      {deadline ? (
        <div className="rounded-xl border border-white/60 bg-white/45 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink">Deadline {deadline} · {daysRemaining} days left</span>
            <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => setEditingDeadline(true)}>Change</button>
          </div>
          {proj && (
            <div className="mt-1 text-xs text-muted">
              ~{proj.dailyNewCardsNeeded} new/day · ~{proj.estimatedMinutesPerDay} min/day · {proj.recommendedSessionsPerDay} session{proj.recommendedSessionsPerDay === 1 ? '' : 's'}/day
            </div>
          )}
          {proj && !proj.isOnTrack && (
            <div className="mt-2 rounded-lg border border-rose-300/50 bg-rose-50/70 px-3 py-1.5 text-xs font-semibold text-rose-700">
              Off track — need {proj.dailyNewCardsNeeded}/day but only adding {proj.recentAvgNewPerDay}/day.
            </div>
          )}
          {proj && proj.isOnTrack && <div className="mt-2 text-xs font-semibold text-emerald-600">On track ✓</div>}
        </div>
      ) : (
        <button className="btn btn-soft" onClick={() => setEditingDeadline(true)}>+ Set deadline</button>
      )}

      <label className="flex items-center justify-between gap-3 pt-1 text-sm">
        <span className="font-medium text-ink">
          Mix topics while studying <span className="text-muted">(interleaving)</span>
        </span>
        <Toggle on={!!settings.interleavingEnabled} onChange={toggleInterleaving} />
      </label>

      {editingDeadline && (
        <DeadlineModal
          deckId={deckId}
          current={deadline}
          onClose={() => setEditingDeadline(false)}
          onSaved={() => { setEditingDeadline(false); load(); flash?.('Deadline updated'); }}
        />
      )}
    </div>
  );
}

function DeadlineModal({ deckId, current, onClose, onSaved }) {
  const [date, setDate] = useState(current || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!date) return;
    setSaving(true);
    setErr('');
    try {
      await api.post(`/api/decks/${deckId}/deadline`, { deadline: date });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2, 'Could not set deadline'));
      setSaving(false);
    }
  };
  return (
    <Modal title="Set deck deadline" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorBanner message={err} />}
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Target date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" required />
        </label>
        <p className="text-xs text-muted">Summit will work out how many new cards per day you need to finish in time.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving || !date} className="btn btn-primary">{saving ? 'Saving…' : 'Save deadline'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewSession({ classId, deckId = null, deckName, cards = [], className, flash, onClose }) {
  const [queue, setQueue] = useState(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exiting, setExiting] = useState(false); // fades the card out on a menu action
  const [interactions, setInteractions] = useState(0);
  const [meta, setMeta] = useState({ studyLimit: Infinity, sessionsNeeded: 1, maxCardsPerSession: 30, interleavingEnabled: false });
  const startedAt = useRef(Date.now());
  const timesSeen = useRef({}); // cardId → times shown today (same-session cap 5)
  const easeSum = useRef(0);
  const reviewedCount = useRef(0);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        if (deckId) {
          const { data } = await api.get(`/api/study/today/${deckId}`);
          const all = [...(data.newCards || []), ...(data.reviewCards || [])];
          setQueue(data.interleavingEnabled ? shuffle(all) : all);
          setMeta({
            studyLimit: data.studyLimit ?? Infinity,
            sessionsNeeded: data.sessionsNeeded ?? 1,
            maxCardsPerSession: data.maxCardsPerSession ?? 30,
            interleavingEnabled: !!data.interleavingEnabled,
          });
        } else {
          // No deck selected → study the loaded due cards, new ones first.
          const due = cards.filter(isDue);
          setQueue([...due.filter((c) => !c.nextReviewDate), ...due.filter((c) => c.nextReviewDate)]);
        }
        startedAt.current = Date.now();
      } catch (e) {
        setErr(errorMessage(e));
        setQueue([]);
      }
    })();
  }, [deckId]);

  const rate = async (rating) => {
    const card = queue[idx];
    if (!card) return;
    setSubmitting(true);
    const timeSpentSeconds = Math.round((Date.now() - startedAt.current) / 1000);
    try {
      const { data } = await api.post(`/api/flashcards/${card.id}/rate`, { rating, timeSpentSeconds });
      reviewedCount.current += 1;
      easeSum.current += data.easeFactor ?? 0;
      setInteractions((n) => n + 1);

      // Same-session re-queue: failed cards (rating < 3) always; OK (3) at 50%;
      // capped at 5 views per card so a stubborn card can't loop forever.
      const shown = (timesSeen.current[card.id] || 0) + 1;
      timesSeen.current[card.id] = shown;
      const requeue = shown < 5 && (data.shouldShowAgainToday || (rating === 3 && Math.random() < 0.5));
      setQueue((q) => {
        if (!requeue) return q;
        const next = q.slice();
        next.splice(Math.min(next.length, idx + 3), 0, card); // reappear a few cards later
        return next;
      });

      setRevealed(false);
      startedAt.current = Date.now();
      setIdx((i) => i + 1);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Delete / bury / suspend the current card, then fade it out and advance.
  const ACTION_TOAST = { delete: 'Card deleted', bury: 'Card buried', suspend: 'Card suspended' };
  const doAction = async (type) => {
    const c = queue?.[idx];
    if (!c || exiting) return;
    setExiting(true);
    try {
      if (type === 'delete') await api.delete(`/api/learn/cards/${c.id}`);
      else await api.post(`/api/learn/cards/${c.id}/${type}`); // bury | suspend
    } catch (e) {
      setErr(errorMessage(e));
      setExiting(false);
      return;
    }
    flash?.(ACTION_TOAST[type]);
    // Let the fade play, then drop the card — idx now points at the next card.
    setTimeout(() => {
      setRevealed(false);
      setQueue((q) => q.filter((_, i) => i !== idx));
      startedAt.current = Date.now();
      setExiting(false);
    }, 180);
  };

  const finish = () => onClose();

  // Swipe left/right toggles the answer (mobile affordance).
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    if (Math.abs(touchX.current - e.changedTouches[0].clientX) > 50) setRevealed((r) => !r);
    touchX.current = null;
  };

  const total = queue?.length ?? 0;
  const limitReached = Number.isFinite(meta.studyLimit) && interactions >= meta.studyLimit;
  const done = queue !== null && (idx >= total || limitReached);
  const card = queue && idx < total && !limitReached ? queue[idx] : null;

  // Re-study the same set from the top (a light "cram again" pass).
  const reviewAgain = () => { setIdx(0); setRevealed(false); startedAt.current = Date.now(); };

  // Finished the queue (or hit the daily limit) → celebratory completion overlay.
  if (done && total > 0) {
    const avgEase = reviewedCount.current ? easeSum.current / reviewedCount.current : 0;
    return (
      <DeckCompletionAnimation
        count={reviewedCount.current}
        summary={[
          { label: 'Cards reviewed', value: reviewedCount.current },
          { label: 'Interactions', value: interactions },
          { label: 'Avg ease', value: avgEase ? avgEase.toFixed(2) : '—' },
        ]}
        note={
          limitReached
            ? 'Daily study limit reached — great work!'
            : meta.sessionsNeeded > 1
              ? `About ${meta.sessionsNeeded} sessions suggested today to stay on pace`
              : null
        }
        onReviewAgain={reviewAgain}
        onBackToDecks={finish}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-4">
      <div className="glass-panel mt-6 flex w-full max-w-xl flex-col gap-4 p-5 sm:mt-10 sm:p-6">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-semibold text-muted">
            {deckName ? `${deckName} · Study` : `${className} · Study`}
          </span>
          <button onClick={finish} className="text-2xl leading-none text-muted hover:text-ink" aria-label="End session">×</button>
        </div>
        {err && <ErrorBanner message={err} />}
        {queue === null ? (
          <Spinner label="Building your study queue…" />
        ) : total === 0 ? (
          <EmptyState title="Nothing due right now">Great work — check back later!</EmptyState>
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/40">
              <div className="h-full rounded-full transition-all" style={{ width: `${(idx / total) * 100}%`, background: 'var(--grad-teal-purple)' }} />
            </div>
            <p className="text-center text-xs font-medium text-muted">
              Card {idx + 1} of {total}
              {Number.isFinite(meta.studyLimit) && (
                <span> · {interactions}/{meta.studyLimit} interactions</span>
              )}
            </p>
            <div className="relative">
              {/* 3-dot study actions — lives outside the scroll container so its
                  dropdown isn't clipped. */}
              <StudyCardMenu onAction={doAction} disabled={submitting || exiting} />
              <div
                className={`flex max-h-[26rem] min-h-[10rem] overflow-y-auto overscroll-contain rounded-2xl bg-white/50 p-6 text-center transition-opacity duration-150 sm:min-h-[8rem] ${exiting ? 'opacity-0' : 'opacity-100'}`}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
              >
                {/* m-auto centers short cards vertically but collapses to top-aligned
                    when content overflows, so long answers stay fully scrollable. */}
                <div className="m-auto w-full">
                  <CardFace card={card} revealed={revealed} />
                </div>
              </div>
            </div>
            {!revealed ? (
              <button className="btn btn-primary min-h-[3rem] w-full" onClick={() => setRevealed(true)}>Show answer</button>
            ) : (
              <div>
                <p className="mb-2 text-center text-xs font-medium text-muted">How well did you know it?</p>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {RATINGS.map((c) => (
                    <button key={c.v} disabled={submitting} onClick={() => rate(c.v)}
                      className={`flex min-h-[3rem] flex-col items-center justify-center rounded-xl border bg-white/60 py-2 text-xs font-semibold transition disabled:opacity-50 ${c.cls}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
