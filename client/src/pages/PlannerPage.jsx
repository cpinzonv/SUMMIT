import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, gradeColor, classAccent } from '../components/ui';
import { EmptyHero, CalendarIllustration } from '../components/EmptyHero';

const TABS = [
  { key: 'current', label: 'Current' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_META = {
  current: { label: 'In progress', badge: 'bg-sky-100 text-sky-700' },
  upcoming: { label: 'Upcoming', badge: 'bg-violet-100 text-violet-700' },
  completed: { label: 'Completed', badge: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', badge: 'bg-slate-200 text-slate-500' },
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const asDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`) : null);
const fmt = (s) =>
  asDate(s)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Derive a class's status: archived (flag) wins, otherwise by start/end dates. */
function classStatus(cls) {
  if (cls.archivedAt) return 'archived';
  const today = startOfToday();
  const start = asDate(cls.startDate);
  const end = asDate(cls.endDate);
  if (end && today > end) return 'completed';
  if (start && today < start) return 'upcoming';
  return 'current'; // spans today, or no dates → treat as in progress
}

export default function PlannerPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramTab = params.get('tab');
  const tab = TABS.some((t) => t.key === paramTab) ? paramTab : 'current';
  const setTab = (t) => setParams(t === 'current' ? {} : { tab: t }, { replace: true });

  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch ALL classes (active + archived) on mount, so anything created on the
  // Dashboard/Schedule shows here as soon as the Planner is opened.
  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/api/classes?include=archived');
      setClasses(data.classes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withStatus = useMemo(
    () => classes.map((c) => ({ ...c, _status: classStatus(c) })),
    [classes],
  );
  const counts = useMemo(() => {
    const c = { current: 0, upcoming: 0, completed: 0, archived: 0 };
    for (const cl of withStatus) c[cl._status] += 1;
    return c;
  }, [withStatus]);
  const shown = useMemo(() => withStatus.filter((c) => c._status === tab), [withStatus, tab]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Planner</h1>
          <p className="mt-1 text-sm text-muted">All your classes, by where they are in the term</p>
        </div>
        <button onClick={() => navigate('/classes/new')} className="btn btn-primary">
          + New class
        </button>
      </div>

      {/* Tabs with per-status counts */}
      <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white/75 text-brand-700 shadow-sm' : 'text-muted hover:bg-white/50 hover:text-ink'
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="ml-1.5 text-xs opacity-70">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading your classes…" />
      ) : classes.length === 0 ? (
        <EmptyHero
          illustration={<CalendarIllustration />}
          headline="No classes yet"
          subheading="Add your courses to see them grouped by current, upcoming, completed, and archived."
          ctaLabel="Create your first class"
          onCta={() => navigate('/classes/new')}
        />
      ) : shown.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-muted">
          No {STATUS_META[tab].label.toLowerCase()} classes.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((cls) => (
            <ClassCard
              key={cls.id}
              cls={cls}
              status={cls._status}
              onOpen={cls._status === 'archived' ? null : () => navigate(`/classes/${cls.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClassCard({ cls, status, onOpen }) {
  const meta = STATUS_META[status];
  const grade = cls.currentGrade;
  const dates =
    fmt(cls.startDate) && fmt(cls.endDate)
      ? `${fmt(cls.startDate)} – ${fmt(cls.endDate)}`
      : fmt(cls.startDate) || fmt(cls.endDate) || 'No dates set';

  return (
    <div
      onClick={onOpen || undefined}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => (e.key === 'Enter' || e.key === ' ') && onOpen() : undefined}
      className={`glass-card relative overflow-hidden p-5 ${
        status === 'archived'
          ? 'opacity-70'
          : 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_rgba(180,120,80,0.4)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundImage: classAccent(cls, 0) }} />
          <div className="min-w-0">
            <h3 className="truncate font-bold text-ink">{cls.name}</h3>
            <p className="truncate text-xs text-muted">
              {[cls.code, cls.term].filter(Boolean).join(' · ') || 'No code'}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{dates}</span>
        {grade?.percentage != null && (
          <span className={`shrink-0 font-bold ${gradeColor(grade.percentage)}`}>
            {grade.percentage}%{grade.letter ? ` (${grade.letter})` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
