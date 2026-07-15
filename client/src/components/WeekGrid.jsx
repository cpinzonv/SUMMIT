/**
 * Shared weekly timetable. Time on the Y axis, weekdays on the X axis; each
 * meeting is an absolutely-positioned block. Purely presentational — callers
 * pass pre-computed blocks, so the grid never fetches or knows about classes vs.
 * candidate schedules. On narrow screens the days stack into per-day lists.
 *
 * Extracted from the Schedule tab's timetable so the Semester Schedule Builder's
 * compare view (Stage B) and the Planner's schedule preview render on the exact
 * same grid instead of duplicating layout code.
 *
 * A block is:
 *   { key, dayIdx (0=Mon … 6=Sun), startMin, endMin,
 *     title, subtitle, detail?, gradient, conflict?, pinned?, onClick? }
 */

const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HOUR_PX = 52;

function fmtHour(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/**
 * Pick the [startHour, endHour] window that fits every block, clamped to a
 * sensible default frame so a lone evening class doesn't squash the morning.
 */
export function fitWindow(blocks, { min = 8, max = 18 } = {}) {
  let lo = min;
  let hi = max;
  for (const b of blocks) {
    if (b.startMin != null) lo = Math.min(lo, Math.floor(b.startMin / 60));
    if (b.endMin != null) hi = Math.max(hi, Math.ceil(b.endMin / 60));
  }
  return { startHour: lo, endHour: hi };
}

export function WeekGrid({
  blocks = [],
  days = DEFAULT_DAYS,
  startHour = 8,
  endHour = 18,
  emptyLabel = 'No classes',
}) {
  const totalMins = (endHour - startHour) * 60;
  const gridHeight = (endHour - startHour) * HOUR_PX;
  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  const cols = `56px repeat(${days.length}, 1fr)`;

  const posOf = (b) => {
    const top = ((b.startMin - startHour * 60) / totalMins) * gridHeight;
    const height = Math.max(22, ((b.endMin - b.startMin) / totalMins) * gridHeight);
    return { top, height };
  };

  return (
    <div className="glass-card overflow-x-auto p-4">
      {/* Desktop / wide: time-grid. Hidden on small screens. */}
      <div className="hidden min-w-[640px] sm:block">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => (
            <div key={d} className="pb-2 text-center text-sm font-bold text-ink">{d}</div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          {/* Hour labels */}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] font-semibold text-muted" style={{ top: i * HOUR_PX }}>
                {fmtHour(h * 60)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((d, di) => (
            <div key={d} className="relative border-l border-white/40" style={{ height: gridHeight }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-white/30" style={{ top: i * HOUR_PX }} />
              ))}
              {blocks
                .filter((b) => b.dayIdx === di)
                .map((b) => {
                  const { top, height } = posOf(b);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={b.onClick}
                      disabled={!b.onClick}
                      className={`absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left text-white shadow-sm transition ${
                        b.onClick ? 'hover:brightness-105' : 'cursor-default'
                      } ${b.conflict ? 'ring-2 ring-rose-500' : ''} ${b.pinned ? 'ring-2 ring-white/90' : ''}`}
                      style={{ top, height, backgroundImage: b.gradient }}
                      title={b.hoverTitle}
                    >
                      <div className="flex items-center gap-1">
                        {b.pinned && <PinGlyph />}
                        <div className="truncate text-[11px] font-bold leading-tight">{b.title}</div>
                      </div>
                      {b.subtitle && <div className="truncate text-[9px] opacity-90">{b.subtitle}</div>}
                      {b.detail && height > 40 && <div className="truncate text-[9px] opacity-80">{b.detail}</div>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: stack days vertically as lists. */}
      <div className="space-y-4 sm:hidden">
        {days.map((d, di) => {
          const dayBlocks = blocks.filter((b) => b.dayIdx === di).sort((a, b) => a.startMin - b.startMin);
          return (
            <div key={d}>
              <div className="mb-1.5 text-sm font-bold text-ink">{d}</div>
              {dayBlocks.length === 0 ? (
                <p className="text-xs text-muted">{emptyLabel}</p>
              ) : (
                <div className="space-y-1.5">
                  {dayBlocks.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={b.onClick}
                      disabled={!b.onClick}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white ${
                        b.conflict ? 'ring-2 ring-rose-500' : ''
                      } ${b.pinned ? 'ring-2 ring-white/90' : ''}`}
                      style={{ backgroundImage: b.gradient }}
                    >
                      {b.pinned && <PinGlyph />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{b.title}</div>
                        {(b.subtitle || b.detail) && (
                          <div className="truncate text-[11px] opacity-90">
                            {[b.subtitle, b.detail].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PinGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0 fill-current">
      <path d="M9.5 1.5a1 1 0 0 0-.7 1.7l.3.3-3 3-1.9-.5a1 1 0 0 0-1 1.6l2.3 2.3-3 3a1 1 0 1 0 1.4 1.4l3-3 2.3 2.3a1 1 0 0 0 1.6-1l-.5-1.9 3-3 .3.3a1 1 0 0 0 1.7-.7 1 1 0 0 0-.3-.7l-4.4-4.4a1 1 0 0 0-.7-.3z" />
    </svg>
  );
}
