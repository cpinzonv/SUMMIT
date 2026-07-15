/**
 * DATE-only calendar values — e.g. a class's semester start/end dates.
 *
 * These carry NO time-of-day: "2026-08-25" means the whole calendar day, in
 * whatever timezone the student is in. The API stores them in a Postgres `DATE`
 * column and serializes them as a UTC-midnight ISO string
 * ("2026-08-25T00:00:00.000Z"). Rendering that through `new Date(...)` + local
 * getters shifts it one day earlier in negative-offset zones (UTC-5 →
 * "2026-08-24"). These helpers keep the *calendar date* stable both into and out
 * of an <input type="date">, with no timezone math in either direction.
 *
 * Scope: DATE-only fields ONLY. Time and datetime values — assignment due /
 * planned dates (TIMESTAMPTZ) and class meeting start/end times (wall-clock
 * HH:MM) — carry a real instant/time and keep their existing local handling.
 * Do not route those through here.
 */

// Leading YYYY-MM-DD of a date-only string or a UTC-midnight ISO timestamp.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * DATE-only API value → 'YYYY-MM-DD' for an <input type="date">.
 * Reads the calendar date verbatim; never applies a timezone offset.
 */
export function dateOnlyToInput(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(DATE_RE);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  // Fallback for Date objects: use UTC parts (the API's date is UTC-anchored),
  // so the result matches the stored calendar day regardless of local zone.
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * <input type="date"> 'YYYY-MM-DD' → the value to persist for a DATE-only field.
 * Sends the bare calendar date so the server stores it verbatim in its DATE
 * column — no local→UTC shift on write. Empty/invalid input → null.
 */
export function inputToDateOnly(value) {
  const m = typeof value === 'string' ? value.match(DATE_RE) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
