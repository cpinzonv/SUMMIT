import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  Toast,
  gradeColor,
  classGradient,
  computeGpa,
} from '../components/ui';
import { lmsApi, lmsStatusAll, summarizeSync, lmsLabel } from '../lib/lms';
import { dueStatus, countdownTone } from '../lib/dueDate';

export default function DashboardPage() {
  const { preferences, refreshUser } = useAuth();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archivedNotice, setArchivedNotice] = useState(0);
  const [toast, setToast] = useState(null);
  const [syncingProvider, setSyncingProvider] = useState(null);
  // Connected LMS providers (each gets its own "Sync" button).
  const [connectedLms, setConnectedLms] = useState([]);
  // Class ids currently playing the archive exit animation (before removal).
  const [animatingIds, setAnimatingIds] = useState(() => new Set());

  // Archive a class with a smooth exit: play the fade/slide animation, then call
  // the API and drop it from the list once the animation has finished.
  const archiveClass = (id) => {
    setAnimatingIds((prev) => new Set(prev).add(id));
    setTimeout(async () => {
      try {
        await api.put(`/api/classes/${id}/archive`);
        setClasses((cs) => cs.filter((c) => c.id !== id));
        setToast({ type: 'success', msg: 'Class archived' });
      } catch (err) {
        setToast({ type: 'error', msg: errorMessage(err, 'Could not archive class') });
        setAnimatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }, 500);
  };
  // Auto-archive runs once per dashboard load. Holding the in-flight promise in
  // a ref makes both React StrictMode mounts await the SAME archive call, so the
  // class list is always loaded AFTER expired classes are archived (no stale
  // rows) and the "semester ended" notice fires exactly once.
  const archivePromise = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!archivePromise.current) {
        archivePromise.current = (async () => {
          try {
            const { data: aa } = await api.post('/api/classes/auto-archive');
            if (aa.count > 0) setArchivedNotice(aa.count);
          } catch {
            // Non-fatal — fall through and still load the dashboard.
          }
        })();
      }
      await archivePromise.current;
      try {
        const res = await api.get('/api/classes');
        if (active) setClasses(res.data.classes);
      } catch (err) {
        if (active) setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load which LMS providers are connected so we can show per-provider sync.
  useEffect(() => {
    let active = true;
    lmsStatusAll()
      .then((providers) => {
        if (active) setConnectedLms(providers.filter((p) => p.connected));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!archivedNotice) return undefined;
    const t = setTimeout(() => setArchivedNotice(0), 6000);
    return () => clearTimeout(t);
  }, [archivedNotice]);

  useEffect(() => {
    if (!toast || toast.loading) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const syncProvider = async (provider) => {
    const label = lmsLabel(provider);
    setSyncingProvider(provider);
    setToast({ loading: true, msg: `Syncing assignments from ${label}…` });
    try {
      const result = await lmsApi(provider).sync();
      const res = await api.get('/api/classes');
      setClasses(res.data.classes);
      await refreshUser();
      setToast({ type: 'success', msg: summarizeSync(result, provider) });
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, `${label} sync failed`) });
    } finally {
      setSyncingProvider(null);
    }
  };

  const graded = classes.filter((c) => c.currentGrade?.percentage != null);
  const average =
    graded.length > 0
      ? Math.round(
          (graded.reduce((sum, c) => sum + c.currentGrade.percentage, 0) /
            graded.length) *
            10,
        ) / 10
      : null;
  const gpa = computeGpa(classes);

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Your active classes — keep climbing toward your summit
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connectedLms.map((p) => (
            <button
              key={p.provider}
              onClick={() => syncProvider(p.provider)}
              disabled={!!syncingProvider}
              className="btn btn-soft"
            >
              {syncingProvider === p.provider ? 'Syncing…' : `↻ Sync ${p.label}`}
            </button>
          ))}
          <Link to="/classes/new" className="btn btn-primary">
            + New class
          </Link>
        </div>
      </div>

      {archivedNotice > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/60 bg-white/55 px-4 py-3 text-sm backdrop-blur">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ backgroundImage: 'var(--grad-teal-purple)' }}>
            🗄
          </span>
          <span className="font-medium text-ink">
            {archivedNotice} {archivedNotice === 1 ? 'class' : 'classes'} archived as the semester ended.
          </span>
          <Link to="/archives" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
            View archives →
          </Link>
        </div>
      )}

      {loading ? (
        <Spinner label="Loading classes…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Active classes" value={classes.length} glow={classGradient(null, 0)} />
            <Stat
              label="Current GPA"
              value={gpa == null ? '—' : gpa.toFixed(2)}
              gradient
              glow={classGradient(null, 2)}
            />
            <Stat
              label="Overall average"
              value={average == null ? '—' : `${average}%`}
              valueClass={gradeColor(average)}
              glow={classGradient(null, 1)}
            />
            <Stat label="Graded classes" value={graded.length} glow={classGradient(null, 3)} />
          </div>

          {classes.length === 0 ? (
            <EmptyState title="No classes yet">
              <Link to="/classes/new" className="font-semibold text-brand-600 hover:underline">
                Create your first class
              </Link>
            </EmptyState>
          ) : preferences.defaultDashboardView === 'list' ? (
            <div className="glass-card divide-y divide-white/40 overflow-hidden">
              {classes.map((cls, i) => (
                <ClassRow
                  key={cls.id}
                  cls={cls}
                  index={i}
                  animating={animatingIds.has(cls.id)}
                  onArchive={archiveClass}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {classes.map((cls, i) => (
                <ClassCard
                  key={cls.id}
                  cls={cls}
                  index={i}
                  animating={animatingIds.has(cls.id)}
                  onArchive={archiveClass}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Toast toast={toast} />
    </div>
  );
}

function Stat({ label, value, valueClass = 'text-ink', gradient = false, glow }) {
  return (
    <div className="glass-card relative overflow-hidden p-5">
      {glow && (
        <span
          className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-50 blur-2xl"
          style={{ backgroundImage: glow }}
        />
      )}
      <div className="relative text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`relative mt-1 text-3xl font-extrabold ${gradient ? 'text-gradient' : valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function archiveHandler(onArchive, id) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('Archive this class? It moves to your Archives.')) onArchive(id);
  };
}

function ClassCard({ cls, index, animating = false, onArchive }) {
  const grade = cls.currentGrade;
  const gradient = classGradient(cls, index);
  return (
    <Link
      to={`/classes/${cls.id}`}
      className={`glass-card group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_22px_48px_-18px_rgba(180,120,80,0.45)] archive-exit ${animating ? 'archive-animating' : ''}`}
    >
      {onArchive && (
        <button
          type="button"
          onClick={archiveHandler(onArchive, cls.id)}
          title="Archive class"
          aria-label="Archive class"
          className="absolute right-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 transition hover:bg-white/70 hover:text-ink group-hover:opacity-100"
        >
          🗄
        </button>
      )}
      {/* Unique gradient wash tinting the whole card */}
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.24] transition group-hover:opacity-[0.34]"
        style={{ backgroundImage: gradient }}
      />
      {/* Soft glowing blobs filling the frosted card */}
      <span
        className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full opacity-80 blur-3xl transition group-hover:opacity-100"
        style={{ backgroundImage: gradient }}
      />
      <span
        className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full opacity-50 blur-3xl"
        style={{ backgroundImage: gradient }}
      />
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-12 w-1.5 rounded-full"
            style={{ backgroundImage: gradient }}
          />
          <div>
            <h3 className="font-bold text-ink">{cls.name}</h3>
            <p className="text-xs text-muted">
              {[cls.code, cls.term].filter(Boolean).join(' · ') || 'No code'}
            </p>
            {cls.overdueCount > 0 && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                {cls.overdueCount} overdue
              </span>
            )}
            {cls.nextDueDate && (
              <p className={`mt-1 text-[11px] font-semibold ${countdownTone(dueStatus(cls.nextDueDate))}`}>
                Next due: {dueStatus(cls.nextDueDate).countdownLabel}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-extrabold ${gradeColor(grade?.percentage)}`}>
            {grade?.percentage != null ? `${grade.percentage}%` : '—'}
          </div>
          <div className="text-xs font-medium text-muted">
            {grade?.letter || 'No grades'}
          </div>
        </div>
      </div>
      <p className="relative mt-4 flex gap-3 text-xs text-muted">
        <span>
          {grade?.gradedAssignments
            ? `${grade.gradedAssignments} graded`
            : 'No graded assignments'}
        </span>
        {cls.attendanceRate != null && (
          <span>· {cls.attendanceRate}% attendance</span>
        )}
      </p>
    </Link>
  );
}

function ClassRow({ cls, index, animating = false, onArchive }) {
  const grade = cls.currentGrade;
  return (
    <Link
      to={`/classes/${cls.id}`}
      className={`group flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/40 archive-exit ${animating ? 'archive-animating' : ''}`}
    >
      <span className="h-9 w-1.5 rounded-full" style={{ backgroundImage: classGradient(cls, index) }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{cls.name}</span>
          {cls.overdueCount > 0 && (
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
              {cls.overdueCount} overdue
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted">
          {[cls.code, cls.term].filter(Boolean).join(' · ') || 'No code'}
          {cls.nextDueDate && (
            <span className={`ml-2 font-semibold ${countdownTone(dueStatus(cls.nextDueDate))}`}>
              · {dueStatus(cls.nextDueDate).countdownLabel}
            </span>
          )}
        </div>
      </div>
      {cls.attendanceRate != null && (
        <span className="hidden text-xs text-muted sm:inline">{cls.attendanceRate}% att.</span>
      )}
      <div className="text-right">
        <div className={`text-lg font-extrabold ${gradeColor(grade?.percentage)}`}>
          {grade?.percentage != null ? `${grade.percentage}%` : '—'}
        </div>
        <div className="text-[10px] font-medium text-muted">{grade?.letter || 'No grades'}</div>
      </div>
      {onArchive && (
        <button
          type="button"
          onClick={archiveHandler(onArchive, cls.id)}
          title="Archive class"
          aria-label="Archive class"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-0 transition hover:bg-white/70 hover:text-ink group-hover:opacity-100"
        >
          🗄
        </button>
      )}
    </Link>
  );
}
