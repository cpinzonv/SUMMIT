import { useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Toast, classGradient, classAccent, isGlassColor } from './ui';
import { generateClassSessions } from '../lib/classMeetings';
import { effectiveDate, hoursLabel } from '../lib/scheduleLoad';

/**
 * Schedule — interactive single-day view (Stage 3). Drag assignments from the
 * "Unscheduled" tray onto the timeline to plan WHEN you'll do them; each block's
 * HEIGHT is its AI-estimated duration. Dropping saves `scheduled_time` (an
 * independent field — never touches due_date / planned_date / board_stage).
 *
 * Manual only: assignments are unscheduled until dragged. Class meetings render
 * as fixed, non-draggable anchor blocks. Drag uses native HTML5 drag-and-drop —
 * the same approach as the To-Do / class Kanban boards (components/StageBoard) —
 * rather than a new drag library.
 */

const DEFAULT_START_MIN = 7 * 60; // 7:00 — same visible range as the week grid
const DEFAULT_END_MIN = 22 * 60; // 22:00
const PX_PER_MIN = 1; // day view is a touch taller than the week grid for easier dropping
const SNAP = 15; // minutes

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtHour = (min) => {
  const h = Math.floor(min / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1} ${ap}`;
};
const fmtClock = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${pad(m)}${ap}` : `${h12}${ap}`;
};
const rangeLabel = (start, dur) => `${fmtClock(start)}–${fmtClock(start + dur)}`;
const minutesOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export function ScheduleDayView({ date, activeClasses, cards, setCards, onBack }) {
  const dayKey = dateKey(date);
  const timelineRef = useRef(null);
  const [drag, setDrag] = useState(null); // { cardId, durationMin, grabOffsetMin, source }
  const [dropMin, setDropMin] = useState(null); // snapped top of the drop preview
  const [toast, setToast] = useState(null);

  const activeClassIds = useMemo(() => new Set(activeClasses.map((c) => c.id)), [activeClasses]);

  // Fixed class meetings for this day (non-draggable anchors).
  const sessions = useMemo(() => {
    const out = [];
    activeClasses.forEach((cls, i) => {
      const gradient = classGradient(cls, i);
      const glass = isGlassColor(cls.color);
      for (const s of generateClassSessions(cls, { from: dayKey, to: dayKey })) {
        out.push({ ...s, gradient, glass });
      }
    });
    return out;
  }, [activeClasses, dayKey]);

  const durationMin = (card) => Math.round((card.estimatedHours != null ? card.estimatedHours : 1) * 60);

  // Assignment blocks scheduled onto THIS day (done ones render muted).
  const blocks = useMemo(
    () =>
      cards
        .filter(
          (c) =>
            c.source === 'assignment' &&
            activeClassIds.has(c.contextId) &&
            c.scheduledTime &&
            dateKey(new Date(c.scheduledTime)) === dayKey,
        )
        .map((c) => ({ card: c, startMin: minutesOf(c.scheduledTime), durationMin: durationMin(c) }))
        .sort((a, b) => a.startMin - b.startMin),
    [cards, activeClassIds, dayKey],
  );

  // Unscheduled work whose effective day is this day (never shows done items).
  const tray = useMemo(
    () =>
      cards.filter(
        (c) =>
          c.source === 'assignment' &&
          activeClassIds.has(c.contextId) &&
          !c.done &&
          c.boardStage !== 'done' &&
          !c.scheduledTime &&
          c.estimatedHours != null &&
          (() => { const d = effectiveDate(c); return d && dateKey(d) === dayKey; })(),
      ),
    [cards, activeClassIds, dayKey],
  );

  // Visible range: 7–22, widened to fit any class meeting or scheduled block.
  const [startMin, endMin] = useMemo(() => {
    let lo = DEFAULT_START_MIN;
    let hi = DEFAULT_END_MIN;
    for (const s of sessions) {
      if (s.startMin != null) lo = Math.min(lo, s.startMin);
      hi = Math.max(hi, s.endMin ?? (s.startMin ?? 0) + 60);
    }
    for (const b of blocks) { lo = Math.min(lo, b.startMin); hi = Math.max(hi, b.startMin + b.durationMin); }
    return [Math.floor(lo / 60) * 60, Math.ceil(hi / 60) * 60];
  }, [sessions, blocks]);

  const gridHeight = (endMin - startMin) * PX_PER_MIN;
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  // A block conflicts when it overlaps a class meeting or another scheduled block.
  const isConflict = (b) =>
    sessions.some((s) => s.startMin != null && overlaps(b.startMin, b.startMin + b.durationMin, s.startMin, s.endMin ?? s.startMin + 60)) ||
    blocks.some((o) => o.card.id !== b.card.id && overlaps(b.startMin, b.startMin + b.durationMin, o.startMin, o.startMin + o.durationMin));

  const totalLabel = useMemo(() => {
    const hrs = [...tray, ...blocks.map((b) => b.card)]
      .reduce((sum, c) => sum + (Number(c.estimatedHours) || 0), 0);
    return hrs > 0 ? hoursLabel(hrs) : null;
  }, [tray, blocks]);

  // Persist scheduled_time, optimistic with rollback + toast on failure.
  const persist = (cardId, iso) => {
    const prev = cards.find((c) => c.id === cardId)?.scheduledTime ?? null;
    if (prev === iso) return;
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, scheduledTime: iso } : c)));
    api.patch(`/api/assignments/${cardId}`, { scheduledTime: iso }).catch(() => {
      setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, scheduledTime: prev } : c)));
      setToast({ type: 'error', msg: 'Could not save — try again.' });
      setTimeout(() => setToast(null), 3500);
    });
  };

  const cursorMin = (clientY) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return startMin;
    return startMin + (clientY - rect.top) / PX_PER_MIN;
  };
  const snapTop = (clientY) => {
    if (!drag) return null;
    let top = cursorMin(clientY) - (drag.grabOffsetMin || 0);
    top = Math.round(top / SNAP) * SNAP;
    return Math.max(startMin, Math.min(top, endMin - drag.durationMin));
  };

  const onTimelineOver = (e) => {
    if (!drag) return;
    e.preventDefault();
    setDropMin(snapTop(e.clientY));
  };
  const onTimelineDrop = (e) => {
    e.preventDefault();
    if (!drag) return;
    const top = snapTop(e.clientY);
    const iso = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(top / 60), top % 60).toISOString();
    persist(drag.cardId, iso);
    setDrag(null);
    setDropMin(null);
  };

  const startDrag = (card, source) => (e) => {
    const grabOffsetMin = source === 'block' ? (e.nativeEvent.offsetY || 0) / PX_PER_MIN : 0;
    setDrag({ cardId: card.id, durationMin: durationMin(card), grabOffsetMin, source });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  };
  const endDrag = () => { setDrag(null); setDropMin(null); };

  const weekday = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="btn btn-soft !px-3 !py-1.5" aria-label="Back to week">← Week</button>
          <div>
            <h2 className="text-xl font-bold text-ink">{weekday}</h2>
            {totalLabel && <p className="text-xs font-semibold text-brand-600">{totalLabel} estimated</p>}
          </div>
        </div>
        <p className="text-xs text-muted">Drag a task onto the timeline to plan when you&rsquo;ll do it.</p>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* Timeline */}
        <div className="glass-card min-w-0 flex-1 overflow-hidden p-0">
          <div className="max-h-[68vh] overflow-y-auto">
            <div className="grid" style={{ gridTemplateColumns: '3.5rem minmax(0, 1fr)', height: `${gridHeight}px` }}>
              {/* Time axis */}
              <div className="relative">
                {hours.map((m) => (
                  <div key={m} className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium text-muted" style={{ top: `${(m - startMin) * PX_PER_MIN}px` }}>
                    {m < endMin ? fmtHour(m) : ''}
                  </div>
                ))}
              </div>

              {/* Day column = drop target */}
              <div
                ref={timelineRef}
                className="relative border-l border-white/30"
                onDragOver={onTimelineOver}
                onDrop={onTimelineDrop}
              >
                {hours.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-white/25" style={{ top: `${(m - startMin) * PX_PER_MIN}px` }} />
                ))}

                {/* Drop preview */}
                {drag && dropMin != null && (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-brand-400/80 bg-brand-50/30"
                    style={{ top: `${(dropMin - startMin) * PX_PER_MIN}px`, height: `${drag.durationMin * PX_PER_MIN}px` }}
                  />
                )}

                {/* Fixed class meetings (anchored, non-draggable) */}
                {sessions.map((s, i) => {
                  const top = ((s.startMin ?? startMin) - startMin) * PX_PER_MIN;
                  const h = ((s.endMin ?? (s.startMin ?? 0) + 60) - (s.startMin ?? 0)) * PX_PER_MIN;
                  return (
                    <div
                      key={`s${i}`}
                      title={`${s.cls.name} · ${rangeLabel(s.startMin, (s.endMin ?? s.startMin + 60) - s.startMin)}${s.location ? ` · ${s.location}` : ''}`}
                      className={`pointer-events-none absolute left-1 right-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] leading-tight ring-1 ring-inset ring-white/40 ${
                        s.glass ? 'bg-white/75 text-ink' : 'text-white'
                      }`}
                      style={{ top: `${top}px`, height: `${Math.max(h - 2, 24)}px`, ...(s.glass ? {} : { backgroundImage: s.gradient }) }}
                    >
                      <div className="truncate font-bold">{s.cls.name}</div>
                      <div className={`truncate ${s.glass ? 'text-muted' : 'text-white/85'}`}>{fmtClock(s.startMin)}{s.endMin ? `–${fmtClock(s.endMin)}` : ''}</div>
                    </div>
                  );
                })}

                {/* Scheduled assignment blocks (draggable) */}
                {blocks.map((b) => {
                  const top = (b.startMin - startMin) * PX_PER_MIN;
                  const h = Math.max(b.durationMin * PX_PER_MIN - 2, 22);
                  const conflict = isConflict(b);
                  const done = b.card.done || b.card.boardStage === 'done';
                  return (
                    <div
                      key={b.card.id}
                      draggable={!done}
                      onDragStart={done ? undefined : startDrag(b.card, 'block')}
                      onDragEnd={endDrag}
                      title={`${b.card.title} · ${rangeLabel(b.startMin, b.durationMin)}${conflict ? ' · overlaps another block' : ''}`}
                      className={`group absolute left-1 right-1 overflow-hidden rounded-lg border bg-white/85 p-1.5 text-left shadow-sm backdrop-blur transition ${
                        done ? 'opacity-45' : 'cursor-grab active:cursor-grabbing hover:shadow-md'
                      } ${conflict ? 'border-amber-400 ring-1 ring-amber-400/70' : 'border-white/60'} ${drag?.cardId === b.card.id ? 'opacity-40' : ''}`}
                      style={{ top: `${top}px`, height: `${h}px`, borderLeft: `3px solid transparent`, borderLeftColor: classColorDot(b.card.color) }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-800">{b.card.title}</span>
                        {!done && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); persist(b.card.id, null); }}
                            aria-label="Unschedule"
                            title="Unschedule"
                            className="-mr-0.5 -mt-0.5 shrink-0 rounded px-1 text-xs leading-none text-slate-400 opacity-0 transition hover:text-slate-700 group-hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-slate-500">
                        {rangeLabel(b.startMin, b.durationMin)}
                        {conflict && <span className="font-semibold text-amber-600"> · overlaps</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Unscheduled tray (side panel on desktop; sits below on mobile) */}
        <div
          className="glass-card w-full shrink-0 p-4 md:w-72"
          onDragOver={(e) => { if (drag?.source === 'block') e.preventDefault(); }}
          onDrop={(e) => { if (drag?.source === 'block') { e.preventDefault(); persist(drag.cardId, null); endDrag(); } }}
        >
          <h3 className="text-sm font-bold text-ink">Unscheduled</h3>
          <p className="mt-0.5 text-xs text-muted">Due or planned for this day. Drag onto the timeline.</p>
          <div className="mt-3 space-y-2">
            {tray.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/50 px-3 py-6 text-center text-xs text-muted/70">
                {blocks.length ? 'Everything for today is scheduled.' : 'Nothing to schedule for this day.'}
              </p>
            ) : (
              tray.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={startDrag(c, 'tray')}
                  onDragEnd={endDrag}
                  className={`flex cursor-grab items-center gap-2 rounded-xl border border-white/50 bg-white/70 px-3 py-2 shadow-sm transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md ${
                    drag?.cardId === c.id ? 'opacity-40' : ''
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundImage: classAccent({ color: c.color }) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.title}</span>
                    <span className="block truncate text-[11px] text-muted">{c.contextName}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-brand-600">{hoursLabel(c.estimatedHours)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

// A visible dot/accent color for a class: its hex, or the brand teal for "glass".
function classColorDot(color) {
  return color && /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : '#3fb8c0';
}
