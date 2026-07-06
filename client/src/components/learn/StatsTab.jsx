import { EmptyHero, StatsIllustration } from '../EmptyHero';

/** A fuller breakdown of the user's learning stats (the header shows the highlights). */
export function StatsTab({ stats }) {
  if (!stats || stats.totalCards === 0) {
    return (
      <EmptyHero
        illustration={<StatsIllustration />}
        headline="No study data yet"
        subheading="Create some flashcards and start a review session to see your progress here."
      />
    );
  }
  const rows = [
    ['New', stats.newCards, '#94a3b8'],
    ['Learning', stats.learningCards, '#f59e0b'],
    ['Review', stats.reviewCards, '#0ea5e9'],
    ['Mastered', stats.masteredCards, '#10b981'],
  ];
  const total = stats.totalCards || 1;
  return (
    <div className="space-y-4">
      <div className="glass-panel p-5">
        <p className="mb-3 text-sm font-semibold text-ink">Mastery breakdown</p>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/40">
          {rows.map(([label, n, color]) => (
            n > 0 ? <div key={label} style={{ width: `${(n / total) * 100}%`, background: color }} title={`${label}: ${n}`} /> : null
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {rows.map(([label, n, color]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              <span className="text-muted">{label}</span>
              <span className="ml-auto font-semibold text-ink">{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Current streak" value={`🔥 ${stats.currentStreak}`} />
        <Metric label="Longest streak" value={stats.longestStreak} />
        <Metric label="Study time" value={`${stats.totalStudyHours}h`} />
        <Metric label="Avg session" value={`${stats.averageSessionMinutes}m`} />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="glass-panel p-4">
      <p className="font-display text-2xl font-bold text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
