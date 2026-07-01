import { useEffect, useRef, useState } from 'react';

/**
 * Premium split-flap style time picker.
 *   <FlipClockPicker value={{ hours, minutes, ampm }} onChange={fn} />
 * - hours: 1–12, minutes: 0–59, ampm: 'AM' | 'PM'
 * - Up/down arrows step each segment; double-click a numeric segment to type.
 * - Each segment flips (rotateX) when its value changes (see .flip-card in index.css).
 * Fully controlled: the parent owns the value and receives every change.
 */

const clampHour = (h) => ((((h - 1) % 12) + 12) % 12) + 1; // wrap 1..12
const wrapMinute = (m) => ((m % 60) + 60) % 60; // wrap 0..59
const pad2 = (n) => String(n).padStart(2, '0');

function ChevronUp() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** One flippable segment: arrows + a display that becomes an input on dbl-click. */
function Segment({ label, display, editable, onStep, onCommit, ariaValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [flip, setFlip] = useState(false);
  const inputRef = useRef(null);
  const prev = useRef(display);

  // Flip whenever the displayed value actually changes.
  useEffect(() => {
    if (prev.current !== display) {
      prev.current = display;
      setFlip(true);
      const t = setTimeout(() => setFlip(false), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [display]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!editable) return;
    setDraft(display.trim());
    setEditing(true);
  };
  const confirm = () => {
    setEditing(false);
    onCommit(draft);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        className="flip-arrow"
        onClick={() => onStep(1)}
        aria-label={`Increase ${label}`}
        tabIndex={-1}
      >
        <ChevronUp />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={confirm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirm(); }
            if (e.key === 'Escape') { setEditing(false); }
          }}
          inputMode="numeric"
          maxLength={2}
          className="flip-input"
          aria-label={`${label} (type a value)`}
        />
      ) : (
        <div
          className={`flip-card ${flip ? 'flip-anim' : ''}`}
          onDoubleClick={startEdit}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          onKeyDown={(e) => { if (editable && e.key === 'Enter') startEdit(); }}
          title={editable ? 'Double-click to type' : undefined}
          aria-label={`${label} ${ariaValue}`}
        >
          {display}
        </div>
      )}

      <button
        type="button"
        className="flip-arrow"
        onClick={() => onStep(-1)}
        aria-label={`Decrease ${label}`}
        tabIndex={-1}
      >
        <ChevronDown />
      </button>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export default function FlipClockPicker({ value, onChange }) {
  const hours = clampHour(Number(value?.hours) || 12);
  const minutes = wrapMinute(Number(value?.minutes) || 0);
  const ampm = value?.ampm === 'PM' ? 'PM' : 'AM';
  const [error, setError] = useState('');

  const emit = (patch) => onChange({ hours, minutes, ampm, ...patch });

  // Transient inline error (also acts as the "toast" for invalid typed input).
  const flashError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 2200);
  };
  useEffect(() => () => {}, []);

  const commitHours = (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 12) return flashError('Hours must be 1–12');
    emit({ hours: n });
  };
  const commitMinutes = (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0 || n > 59) return flashError('Minutes must be 0–59');
    emit({ minutes: n });
  };

  return (
    <div className="flip-clock">
      <div className="flip-clock-row">
        <Segment
          label="Hours"
          display={pad2(hours)}
          editable
          ariaValue={String(hours)}
          onStep={(d) => emit({ hours: clampHour(hours + d) })}
          onCommit={commitHours}
        />
        <span className="flip-colon">:</span>
        <Segment
          label="Minutes"
          display={pad2(minutes)}
          editable
          ariaValue={String(minutes)}
          onStep={(d) => emit({ minutes: wrapMinute(minutes + d * 5) })}
          onCommit={commitMinutes}
        />
        <Segment
          label="AM / PM"
          display={ampm}
          editable={false}
          ariaValue={ampm}
          onStep={() => emit({ ampm: ampm === 'AM' ? 'PM' : 'AM' })}
          onCommit={() => {}}
        />
      </div>
      {error && (
        <p className="mt-2 text-center text-xs font-semibold text-rose-500" role="alert">{error}</p>
      )}
    </div>
  );
}
