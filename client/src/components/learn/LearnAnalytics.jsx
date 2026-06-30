import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { api, errorMessage } from '../../api/client';
import { Spinner, ErrorBanner, EmptyState } from '../ui';

/** Detailed Learn analytics — per-format, per-topic, time breakdown, and trends. */
const COLORS = ['#ff7a52', '#3fb8c0', '#5aa9d6', '#7e8fe0', '#ff9a3d', '#e8739c'];
const RANGES = [['7days', '7 days'], ['30days', '30 days'], ['alltime', 'All time']];

const tooltipStyle = {
  borderRadius: 12, border: '1px solid rgba(255,255,255,0.6)',
  background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', fontSize: 13,
};

export function LearnAnalytics({ classId }) {
  const [scope, setScope] = useState('class'); // 'class' | 'all'
  const [range, setRange] = useState('30days');
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = { timeRange: range, ...(scope === 'class' && classId ? { classId } : {}) };
    try {
      const [a, t] = await Promise.all([
        api.get('/api/learn/analytics/user', { params }),
        api.get('/api/learn/analytics/trending', { params: scope === 'class' && classId ? { classId } : {} }),
      ]);
      setData(a.data); setTrends(t.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range, scope, classId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Crunching your stats…" />;
  if (error) return <ErrorBanner message={error} />;

  const totalCards = data?.flashcardStats.totalCards ?? 0;
  const timePie = [
    { name: 'Flashcards', value: data.timeStats.flashcardsMinutes },
    { name: 'Quizzes', value: data.timeStats.quizzesMinutes },
    { name: 'Podcasts', value: data.timeStats.podcastsMinutes },
  ].filter((d) => d.value > 0);

  const formats = [
    { label: 'Flashcards', icon: '🃏', lines: [`${data.flashcardStats.totalCards} cards`, `${data.flashcardStats.masteredCards} mastered`, `${data.timeStats.flashcardsMinutes} min`] },
    { label: 'Quizzes', icon: '❓', lines: [`${data.quizStats.quizzesTaken} taken`, `${data.quizStats.averageScore}% avg`, `${data.timeStats.quizzesMinutes} min`] },
    { label: 'Podcasts', icon: '🎧', lines: [`${data.podcastStats.podcastsListened} listened`, `${data.podcastStats.averageCompletion}% avg`, `${data.timeStats.podcastsMinutes} min`] },
    { label: 'Guides', icon: '📖', lines: [`${data.guideStats.guides} total`, `${data.guideStats.guidesRead} read`, `${data.guideStats.guidesBookmarked} ★`] },
    { label: 'Mind Maps', icon: '🧠', lines: [`${data.mindmapStats.mindmaps} maps`, `~${data.mindmapStats.averageNodesPerMap} nodes`, ''] },
  ];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {classId && (
          <div className="flex rounded-full bg-white/40 p-0.5">
            {[['class', 'This class'], ['all', 'All classes']].map(([k, l]) => (
              <button key={k} onClick={() => setScope(k)} className={`rounded-full px-3 py-1 font-semibold transition ${scope === k ? 'bg-white/80 text-brand-700 shadow-sm' : 'text-muted'}`}>{l}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex rounded-full bg-white/40 p-0.5">
          {RANGES.map(([k, l]) => (
            <button key={k} onClick={() => setRange(k)} className={`rounded-full px-3 py-1 font-semibold transition ${range === k ? 'bg-white/80 text-brand-700 shadow-sm' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
      </div>

      {totalCards === 0 && data.quizStats.quizzesTaken === 0 ? (
        <EmptyState title="No activity yet">Study some flashcards, take a quiz, or listen to a podcast to see analytics.</EmptyState>
      ) : (
        <>
          {/* Per-format breakdown */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {formats.map((f) => (
              <div key={f.label} className="glass-panel p-4">
                <p className="text-sm font-bold text-ink">{f.icon} {f.label}</p>
                <div className="mt-1 space-y-0.5 text-xs text-muted">{f.lines.filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Time breakdown pie */}
            <Panel title="Time by format" subtitle={`${data.timeStats.totalMinutes} min total · ${data.efficiency.cardsPerHour} cards/hr`}>
              {timePie.length === 0 ? <EmptyState title="No study time logged" /> : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={timePie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                        {timePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v} min`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            {/* Topic breakdown */}
            <Panel title="By topic" subtitle="Cards, mastery & time per tag">
              {data.topicStats.length === 0 ? <EmptyState title="No tagged cards yet" /> : (
                <div className="space-y-2">
                  {data.topicStats.slice(0, 6).map((t) => (
                    <div key={t.topic} className="flex items-center gap-3 text-sm">
                      <span className="w-28 truncate font-medium text-ink">#{t.topic}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/40">
                        <div className="h-full rounded-full" style={{ width: `${t.mastery}%`, background: 'var(--grad-teal-purple)' }} />
                      </div>
                      <span className="w-24 text-right text-xs text-muted">{t.cards} cards · {t.mastery}%</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Trends */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Study time" subtitle="Minutes per day (last 14 days)">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trends.studyTimeTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} interval="preserveStartEnd" minTickGap={20} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={28} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v} min`} />
                    <Bar dataKey="minutes" radius={[4, 4, 0, 0]} fill="#3fb8c0" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Quiz scores" subtitle="Recent quiz performance">
              {trends.quizScoreTrend.length === 0 ? <EmptyState title="No quizzes taken yet" /> : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trends.quizScoreTrend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={28} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                      <Line type="monotone" dataKey="score" stroke="#ff7a52" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div className="glass-panel p-5">
      <div className="mb-3">
        <h3 className="font-bold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
