import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Modal, Spinner, ErrorBanner, EmptyState } from '../ui';
import { Labeled } from './common';
import { exportDeck } from '../../lib/learnExport';
import { CardFace, CardTypeBadge } from './CardTypes';
import { LearnEmptyState } from './LearnEmptyState';

/** Flashcards: manage a class's cards and run spaced-repetition review sessions. */

const MASTERY = {
  new: { label: 'New', cls: 'bg-slate-400/15 text-slate-500' },
  learning: { label: 'Learning', cls: 'bg-amber-400/15 text-amber-600' },
  review: { label: 'Review', cls: 'bg-sky-400/15 text-sky-600' },
  mastered: { label: 'Mastered', cls: 'bg-emerald-400/15 text-emerald-600' },
};
const DIFFICULTY = { easy: 'text-emerald-500', medium: 'text-amber-500', hard: 'text-rose-500' };
// Anki-style 4-button rating: 1=Again, 2=Hard, 3=Good, 4=Easy.
const RATINGS = [
  { v: 1, label: 'Again', cls: 'border-rose-300 text-rose-600 hover:bg-rose-50' },
  { v: 2, label: 'Hard', cls: 'border-orange-300 text-orange-600 hover:bg-orange-50' },
  { v: 3, label: 'Good', cls: 'border-sky-300 text-sky-600 hover:bg-sky-50' },
  { v: 4, label: 'Easy', cls: 'border-emerald-300 text-emerald-600 hover:bg-emerald-50' },
];

const PHASE_LABEL = { learning: 'Learning', review: 'Review', relearning: 'Relearning' };
function PhaseBadge({ phase, step }) {
  if (!phase) return null;
  return (
    <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold text-brand-700">
      {PHASE_LABEL[phase] || phase}{(phase === 'learning' || phase === 'relearning') && step != null ? ` · step ${step + 1}` : ''}
    </span>
  );
}

const isDue = (card) =>
  !card.mastery || !card.mastery.nextReviewAt || new Date(card.mastery.nextReviewAt) <= new Date();

export function FlashcardsTab({ classId, className, refreshStats, flash }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [editorCard, setEditorCard] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/learn/classes/${classId}/cards`);
      setCards(data.cards);
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
  }, [load, refreshStats]);

  const dueCount = cards.filter(isDue).length;

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
            Study due ({dueCount})
          </button>
          <button className="btn btn-soft" onClick={() => setGenerating(true)}>✦ Generate with AI</button>
          <button className="btn btn-soft" onClick={() => setEditorCard(null)}>+ Add card</button>
          <details className="relative">
            <summary className="btn btn-soft cursor-pointer list-none">⬇ Export</summary>
            <div className="glass-panel absolute right-0 z-10 mt-1 w-44 p-1 text-sm">
              <button className="menu-item" onClick={() => exportDeck(cards, className, 'tsv')}>Anki deck (.txt)</button>
              <button className="menu-item" onClick={() => exportDeck(cards, className, 'csv')}>CSV spreadsheet</button>
            </div>
          </details>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {cards.length === 0 ? (
        <LearnEmptyState
          className={className}
          onGenerate={() => setGenerating(true)}
          onAddManual={() => setEditorCard(null)}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
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
          className={className}
          onClose={() => { setReviewing(false); afterChange(); }}
        />
      )}
    </div>
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
      <button onClick={() => setFlipped((f) => !f)} className="text-left text-sm">
        <CardFace card={card} revealed={flipped} />
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

function ReviewSession({ classId, className, onClose }) {
  const [queue, setQueue] = useState(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(Date.now());
  const confidences = useRef([]);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const [dueRes, sessRes] = await Promise.all([
          api.get('/api/learn/due', { params: { classId } }),
          api.post('/api/learn/sessions', { classId }),
        ]);
        setQueue(dueRes.data.cards);
        setSessionId(sessRes.data.session.id);
        startedAt.current = Date.now();
      } catch (e) {
        setErr(errorMessage(e));
        setQueue([]);
      }
    })();
  }, [classId]);

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    const avg = confidences.current.length
      ? confidences.current.reduce((a, b) => a + b, 0) / confidences.current.length
      : undefined;
    try {
      await api.patch(`/api/learn/sessions/${sessionId}`, avg ? { averageConfidence: avg } : {});
    } catch { /* best-effort */ }
  }, [sessionId]);

  const rate = async (rating) => {
    const card = queue[idx];
    setSubmitting(true);
    const timeSpentSeconds = Math.round((Date.now() - startedAt.current) / 1000);
    try {
      await api.post(`/api/learn/cards/${card.id}/review`, {
        rating, timeSpentSeconds, ...(sessionId ? { sessionId } : {}),
      });
      confidences.current.push(rating);
      setRevealed(false);
      startedAt.current = Date.now();
      setIdx((i) => i + 1);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async () => { await endSession(); onClose(); };

  // Swipe left/right toggles the answer (mobile affordance).
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    if (Math.abs(touchX.current - e.changedTouches[0].clientX) > 50) setRevealed((r) => !r);
    touchX.current = null;
  };

  const total = queue?.length ?? 0;
  const done = queue !== null && idx >= total;
  const card = queue && idx < total ? queue[idx] : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-4">
      <div className="glass-panel mt-6 flex w-full max-w-xl flex-col gap-4 p-5 sm:mt-10 sm:p-6">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-semibold text-muted">
            {className} · Study
            {card && <PhaseBadge phase={card.phase} step={card.learningStep} />}
          </span>
          <button onClick={finish} className="text-2xl leading-none text-muted hover:text-ink" aria-label="End session">×</button>
        </div>
        {err && <ErrorBanner message={err} />}
        {queue === null ? (
          <Spinner label="Building your study queue…" />
        ) : total === 0 ? (
          <EmptyState title="Nothing due right now">Great work — check back later!</EmptyState>
        ) : done ? (
          <div className="py-8 text-center">
            <p className="text-4xl">🎉</p>
            <p className="mt-2 text-lg font-bold text-ink">Session complete!</p>
            <p className="text-sm text-muted">You reviewed {total} card{total === 1 ? '' : 's'}.</p>
            <button onClick={finish} className="btn btn-primary mt-4">Done</button>
          </div>
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/40">
              <div className="h-full rounded-full transition-all" style={{ width: `${(idx / total) * 100}%`, background: 'var(--grad-teal-purple)' }} />
            </div>
            <p className="text-center text-xs font-medium text-muted">Card {idx + 1} of {total}</p>
            <div
              className="flex min-h-[10rem] items-center justify-center rounded-2xl bg-white/50 p-5 text-center sm:min-h-[8rem]"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <CardFace card={card} revealed={revealed} />
            </div>
            {!revealed ? (
              <button className="btn btn-primary min-h-[3rem] w-full" onClick={() => setRevealed(true)}>Show answer</button>
            ) : (
              <div>
                <p className="mb-2 text-center text-xs font-medium text-muted">How well did you know it?</p>
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
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
