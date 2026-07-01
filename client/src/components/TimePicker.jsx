import { useEffect, useMemo, useState } from 'react';

/**
 * Glassmorphic time picker — three compact frosted dropdowns (Hour · Minute ·
 * AM/PM) that replace the clunky native time grid. Value in/out is a 24-hour
 * "HH:MM" string (or "" when unset), matching what the class/attendance forms
 * already store.
 *
 * Minutes step by 5 (any off-grid existing value is preserved as an option).
 */
const SELECT =
  'appearance-none rounded-xl border border-white/60 bg-white/50 py-1.5 pl-2.5 pr-6 text-sm font-semibold text-ink outline-none backdrop-blur transition ' +
  'hover:bg-white/70 focus:border-brand-400 focus:bg-white/85 focus:ring-2 focus:ring-brand-300/40';

// A small caret drawn under each select so the native arrow isn't relied on.
const CARET =
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%231B4C5C' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")] bg-[length:10px] bg-[right_0.55rem_center] bg-no-repeat";

const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const BASE_MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

function parse(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  if (!m) return { h: '', min: '', mer: 'AM' };
  const H = Number(m[1]);
  const min = m[2];
  const mer = H >= 12 ? 'PM' : 'AM';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return { h: String(h12), min, mer };
}

function compose(h, min, mer) {
  if (!h || min === '') return '';
  let H = Number(h) % 12;
  if (mer === 'PM') H += 12;
  return `${String(H).padStart(2, '0')}:${min}`;
}

export function TimePicker({ value, onChange, className = '' }) {
  const [state, setState] = useState(() => parse(value));

  // Keep in sync when the parent value changes externally (e.g. syllabus autofill).
  useEffect(() => {
    setState(parse(value));
  }, [value]);

  const minuteOptions = useMemo(() => {
    const opts = [...BASE_MINUTES];
    if (state.min && !opts.includes(state.min)) opts.push(state.min);
    return opts;
  }, [state.min]);

  const update = (next) => {
    setState(next);
    onChange(compose(next.h, next.min, next.mer));
  };

  const setHour = (h) => {
    if (!h) return update({ h: '', min: '', mer: state.mer }); // "–" clears
    update({ ...state, h, min: state.min || '00' }); // default :00 when first set
  };

  const clear = () => update({ h: '', min: '', mer: 'AM' });

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div className="relative">
        <select value={state.h} onChange={(e) => setHour(e.target.value)} aria-label="Hour" className={`${SELECT} ${CARET}`}>
          <option value="">–</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      </div>

      <span className="font-bold text-muted">:</span>

      <div className="relative">
        <select
          value={state.min}
          onChange={(e) => update({ ...state, min: e.target.value, h: state.h || '12' })}
          aria-label="Minute"
          className={`${SELECT} ${CARET}`}
        >
          <option value="">–</option>
          {minuteOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <select
        value={state.mer}
        onChange={(e) => update({ ...state, mer: e.target.value })}
        aria-label="AM or PM"
        className={`${SELECT} ${CARET}`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>

      {state.h && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear time"
          className="grid h-6 w-6 place-items-center rounded-full text-muted transition hover:bg-black/5 hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  );
}
