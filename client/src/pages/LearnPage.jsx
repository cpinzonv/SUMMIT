import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Spinner, ErrorBanner, EmptyState, Toast } from '../components/ui';
import { UpgradePanel } from '../components/learn/common';
import { PaywallModal } from '../components/learn/PaywallModal';
import { FlashcardsTab } from '../components/learn/FlashcardsTab';
import { QuizTab } from '../components/learn/QuizTab';
import { PodcastTab } from '../components/learn/PodcastTab';
import { GuideTab } from '../components/learn/GuideTab';
import { StatsTab } from '../components/learn/StatsTab';
import { LearnAnalytics } from '../components/learn/LearnAnalytics';
import { Icon } from '../components/learn/icons/Icon';

/**
 * Learn tab — multi-format study hub. Flashcards are free; quizzes, podcasts,
 * study guides, and mind maps are Pro. A shared class selector + stat header
 * sit above a tab bar; each tab renders its own content for the selected class.
 */
// `feature` ties a premium tab to its server feature key (for per-feature access).
const TABS = [
  { key: 'study', label: 'Study', icon: 'brain', color: '#4FC3DC', premium: false },
  { key: 'quizzes', label: 'Quizzes', icon: 'question', color: '#1B4C5C', premium: true, feature: 'quizzes' },
  { key: 'podcasts', label: 'Podcasts', icon: 'headphones', color: '#FFB4A2', premium: true, feature: 'podcasts' },
  { key: 'guides', label: 'Guides', icon: 'book', color: '#FF6B4A', premium: true, feature: 'studyGuides' },
  { key: 'stats', label: 'Stats', icon: 'chart', color: '#4FC3DC', premium: false },
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
  // Per-feature access comes from /api/features/status; user.premium is the fast
  // overall flag. featureStatus.features[<feature>].hasAccess drives the locks.
  const [featureStatus, setFeatureStatus] = useState(null);
  const billingEnabled = Boolean(featureStatus?.billingEnabled);
  const isPro = Boolean(user?.premium);
  const [paywall, setPaywall] = useState(null); // { label } when a locked tab is clicked
  const canUse = (t) => !t.premium || (featureStatus?.features?.[t.feature]?.hasAccess ?? isPro);

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
    // Per-feature access + billing state (drives lock icons + the paywall CTA).
    api.get('/api/features/status').then((r) => setFeatureStatus(r.data)).catch(() => {});
  }, [refreshStats]);

  if (loading) return <Spinner label="Loading your study hub…" />;

  const selectedClass = classes.find((c) => c.id === classId);
  const activeTab = TABS.find((t) => t.key === tab);
  const locked = activeTab && !canUse(activeTab);

  const renderTab = () => {
    if (tab === 'stats') {
      return (
        <div className="space-y-6">
          <StatsTab stats={stats} />
          <LearnAnalytics classId={classId} />
        </div>
      );
    }
    if (!classId) return <EmptyState title="No classes yet">Add a class first to start studying.</EmptyState>;
    if (locked) return <UpgradePanel feature={activeTab.label} billingEnabled={billingEnabled} />;
    const props = { classId, className: selectedClass?.name, flash, refreshStats };
    switch (tab) {
      case 'study': return <FlashcardsTab {...props} />;
      case 'quizzes': return <QuizTab {...props} />;
      case 'podcasts': return <PodcastTab {...props} />;
      case 'guides': return <GuideTab {...props} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink"><span className="text-gradient">Learn</span></h1>
          <p className="text-sm text-muted">Study your way — flashcards, quizzes, podcasts & guides</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <StatChip
            label="Day streak"
            value={
              <span className="flex items-center gap-1.5">
                <Icon name="fire" size={22} color="#FF6B4A" />
                {stats?.currentStreak ?? 0}
              </span>
            }
          />
          <StatChip label="Due today" value={stats?.dueToday ?? 0} accent={stats?.dueToday ? '#ff7a52' : undefined} />
          <StatChip label="Mastered" value={`${stats?.masteredCards ?? 0}/${stats?.totalCards ?? 0}`} />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {classes.length === 0 ? (
        <EmptyState title="No classes yet">Add a class first — then study it with flashcards and more.</EmptyState>
      ) : (
        <>
          <div className="glass-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink">
              Class
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="field !w-auto !py-1.5">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            {/* Horizontal-scrolling tab bar — keeps tabs on one swipeable row on phones. */}
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:ml-auto sm:overflow-visible">
              {TABS.map((t) => {
                const tabLocked = !canUse(t);
                return (
                  <button
                    key={t.key}
                    onClick={() => (tabLocked ? setPaywall({ label: t.label }) : setTab(t.key))}
                    title={tabLocked ? `${t.label} is a Pro feature` : undefined}
                    className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      tab === t.key ? 'bg-white/70 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
                    } ${tabLocked ? 'opacity-60' : ''}`}
                  >
                    <Icon name={t.icon} size={18} color={tab === t.key ? t.color : undefined} />
                    {t.label}
                    {tabLocked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-label="Pro feature" className="text-muted">
                        <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {renderTab()}
        </>
      )}

      {paywall && <PaywallModal feature={paywall.label} billingEnabled={billingEnabled} onClose={() => setPaywall(null)} />}
      {toast && <Toast toast={toast} />}
    </div>
  );
}
