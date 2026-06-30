import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Spinner, ErrorBanner, EmptyState, Toast } from '../components/ui';
import { UpgradePanel } from '../components/learn/common';
import { FlashcardsTab } from '../components/learn/FlashcardsTab';
import { QuizTab } from '../components/learn/QuizTab';
import { PodcastTab } from '../components/learn/PodcastTab';
import { GuideTab } from '../components/learn/GuideTab';
import { MindMapTab } from '../components/learn/MindMapTab';
import { StatsTab } from '../components/learn/StatsTab';

/**
 * Learn tab — multi-format study hub. Flashcards are free; quizzes, podcasts,
 * study guides, and mind maps are Pro. A shared class selector + stat header
 * sit above a tab bar; each tab renders its own content for the selected class.
 */
const TABS = [
  { key: 'study', label: 'Study', icon: '🃏', premium: false },
  { key: 'quizzes', label: 'Quizzes', icon: '❓', premium: true },
  { key: 'podcasts', label: 'Podcasts', icon: '🎧', premium: true },
  { key: 'guides', label: 'Guides', icon: '📖', premium: true },
  { key: 'mindmaps', label: 'Mind Maps', icon: '🧠', premium: true },
  { key: 'stats', label: 'Stats', icon: '📊', premium: false },
];

function StatChip({ label, value, accent }) {
  return (
    <div className="glass-panel flex min-w-[6.5rem] flex-col px-4 py-3">
      <span className="text-2xl font-bold text-ink" style={accent ? { color: accent } : undefined}>{value}</span>
      <span className="text-xs font-medium text-muted">{label}</span>
    </div>
  );
}

export default function LearnPage() {
  const { user } = useAuth();
  const isPro = user?.plan === 'pro' || user?.role === 'admin';

  const [classes, setClasses] = useState([]);
  const [stats, setStats] = useState(null);
  const [classId, setClassId] = useState('');
  const [tab, setTab] = useState('study');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const { data } = await api.get('/api/learn/stats');
      setStats(data);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cls] = await Promise.all([api.get('/api/classes'), refreshStats()]);
        const list = (cls.data.classes || []).filter((c) => !c.archivedAt);
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshStats]);

  if (loading) return <Spinner label="Loading your study hub…" />;

  const selectedClass = classes.find((c) => c.id === classId);
  const activeTab = TABS.find((t) => t.key === tab);
  const locked = activeTab?.premium && !isPro;

  const renderTab = () => {
    if (tab === 'stats') return <StatsTab stats={stats} />;
    if (!classId) return <EmptyState title="No classes yet">Add a class first to start studying.</EmptyState>;
    if (locked) return <UpgradePanel feature={activeTab.label} />;
    const props = { classId, className: selectedClass?.name, flash, refreshStats };
    switch (tab) {
      case 'study': return <FlashcardsTab {...props} />;
      case 'quizzes': return <QuizTab {...props} />;
      case 'podcasts': return <PodcastTab {...props} />;
      case 'guides': return <GuideTab {...props} />;
      case 'mindmaps': return <MindMapTab {...props} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink"><span className="text-gradient">Learn</span></h1>
          <p className="text-sm text-muted">Study your way — flashcards, quizzes, podcasts, guides & mind maps</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <StatChip label="Day streak" value={`🔥 ${stats?.currentStreak ?? 0}`} />
          <StatChip label="Due today" value={stats?.dueToday ?? 0} accent={stats?.dueToday ? '#ff7a52' : undefined} />
          <StatChip label="Mastered" value={`${stats?.masteredCards ?? 0}/${stats?.totalCards ?? 0}`} />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {classes.length === 0 ? (
        <EmptyState title="No classes yet">Add a class first — then study it with flashcards and more.</EmptyState>
      ) : (
        <>
          <div className="glass-panel flex flex-wrap items-center gap-3 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="field !w-auto !py-1.5">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <nav className="ml-auto flex flex-wrap gap-1">
              {TABS.map((t) => {
                const tabLocked = t.premium && !isPro;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      tab === t.key ? 'bg-white/70 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
                    }`}
                  >
                    <span aria-hidden>{t.icon}</span>
                    {t.label}
                    {tabLocked && <span title="Pro feature" className="text-xs">🔒</span>}
                  </button>
                );
              })}
            </nav>
          </div>

          {renderTab()}
        </>
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}
