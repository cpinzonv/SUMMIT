import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Spinner,
  ErrorBanner,
  Toast,
  gradeColor,
  classGradient,
  classAccent,
  isGlassColor,
  computeGpa,
} from '../components/ui';
import { EmptyHero, CalendarIllustration } from '../components/EmptyHero';
import { lmsApi, lmsStatusAll, summarizeSync, lmsLabel } from '../lib/lms';
import { dueStatus, countdownTone } from '../lib/dueDate';
import { activitiesApi, ACTIVITY_KINDS, activityOverdue, activityProjectProgress } from '../lib/activities';
import { CreateActivityModal } from '../components/CreateActivityModal';

export default function DashboardPage() {
  const { preferences, refreshUser, user } = useAuth();
  const navigate = useNavigate();

  // Institution admins (school IT) aren't students — send them to their console.
  useEffect(() => {
    if (user?.role === 'institution_admin') navigate('/institution', { replace: true });
  }, [user, navigate]);

  const [classes, setClasses] = useState([]);
  const [activities, setActivities] = useState([]);
  const [showCreateActivity, setShowCreateActivity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [archivedNotice, setArchivedNotice] = useState(0);
  const [plannerNotice, setPlannerNotice] = useState(0);
  const [toast, setToast] = useState(null);
  const [syncingProvider, setSyncingProvider] = useState(null);
  // Connected LMS providers (each gets its own "Sync" button).
  const [connectedLms, setConnectedLms] = useState([]);
  // Weekly estimated-hours workload (this week + next week + per-day breakdown).
  const [workload, setWorkload] = useState(null);
  // On load we (1) move planner courses whose term has started into the
  // Dashboard, then (2) archive expired classes. Holding the in-flight promise
  // in a ref makes both React StrictMode mounts await the SAME work, so the
  // class list is loaded AFTER both run and each notice fires exactly once.
  const initPromise = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!initPromise.current) {
        initPromise.current = (async () => {
          try {
            const { data: sync } = await api.post('/api/plan/sync-active-courses');
            if (sync.count > 0) setPlannerNotice(sync.count);
          } catch {
            // Non-fatal — planner may be empty / unreachable.
          }
          try {
            const { data: aa } = await api.post('/api/classes/auto-archive');
            if (aa.count > 0) setArchivedNotice(aa.count);
          } catch {
            // Non-fatal — fall through and still load the dashboard.
          }
        })();
      }
      await initPromise.current;
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
    api
      .get('/api/workload/weekly')
      .then((r) => active && setWorkload(r.data))
      .catch(() => {});
    activitiesApi
      .list()
      .then((d) => active && setActivities(d.activities))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const reloadActivities = () => activitiesApi.list().then((d) => setActivities(d.activities)).catch(() => {});

  useEffect(() => {
    if (!archivedNotice) return undefined;
    const t = setTimeout(() => setArchivedNotice(0), 6000);
    return () => clearTimeout(t);
  }, [archivedNotice]);

  useEffect(() => {
    if (!plannerNotice) return undefined;
    const t = setTimeout(() => setPlannerNotice(0), 8000);
    return () => clearTimeout(t);
  }, [plannerNotice]);

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
          <AddMenu onAddActivity={() => setShowCreateActivity(true)} />
        </div>
      </div>

      {plannerNotice > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/60 bg-white/55 px-4 py-3 text-sm backdrop-blur">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ backgroundImage: 'var(--grad-teal-purple)' }}>
            🎓
          </span>
          <span className="font-medium text-ink">
            {plannerNotice} planned {plannerNotice === 1 ? 'course' : 'courses'} moved to active from Planner.
          </span>
          <Link to="/planner" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
            View planner →
          </Link>
        </div>
      )}

      {archivedNotice > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/60 bg-white/55 px-4 py-3 text-sm backdrop-blur">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ backgroundImage: 'var(--grad-teal-purple)' }}>
            🗄
          </span>
          <span className="font-medium text-ink">
            {archivedNotice} {archivedNotice === 1 ? 'class' : 'classes'} archived as the semester ended.
          </span>
          <Link to="/planner?tab=archived" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
            View archived →
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

          {workload && (workload.thisWeek.totalHours > 0 || workload.nextWeek.totalHours > 0) && (
            <WorkloadWidget workload={workload} />
          )}

          {classes.length === 0 && activities.length === 0 ? (
            <EmptyHero
              illustration={<CalendarIllustration />}
              headline="Nothing on your dashboard yet"
              subheading="Add your classes and activities (clubs, freelance, volunteering) to start climbing."
              ctaLabel="+ Add your first class"
              onCta={() => navigate('/classes/new')}
              secondaryLabel="+ Add an activity"
              onSecondary={() => setShowCreateActivity(true)}
            />
          ) : preferences.defaultDashboardView === 'list' ? (
            <div className="glass-card divide-y divide-white/40 overflow-hidden">
              {classes.map((cls, i) => (
                <ClassRow key={cls.id} cls={cls} index={i} />
              ))}
              {activities.map((a, i) => (
                <ActivityRow key={a.id} activity={a} index={classes.length + i} />
              ))}
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {classes.map((cls, i) => (
                <ClassCard key={cls.id} cls={cls} index={i} />
              ))}
              {activities.map((a, i) => (
                <ActivityCard key={a.id} activity={a} index={classes.length + i} />
              ))}
            </div>
          )}
        </>
      )}

      {showCreateActivity && (
        <CreateActivityModal
          onClose={() => setShowCreateActivity(false)}
          onCreated={(a) => { setShowCreateActivity(false); navigate(`/activities/${a.id}`); }}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

const DOW_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function WorkloadWidget({ workload }) {
  const days = workload.thisWeek.byDay;
  const max = Math.max(1, ...days.map((d) => d.hours));
  return (
    <div className="glass-card mb-8 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Weekly workload</h2>
        <div className="text-sm text-muted">
          <span className="font-semibold text-ink">This week: {workload.thisWeek.totalHours}h</span>
          <span className="mx-2">·</span>
          Next week: {workload.nextWeek.totalHours}h
        </div>
      </div>
      <div className="flex items-end gap-2" style={{ height: 96 }}>
        {days.map((d, i) => (
          <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-semibold text-muted">{d.hours > 0 ? `${d.hours}h` : ''}</span>
            <div
              className="w-full rounded-t-md"
              style={{
                height: `${(d.hours / max) * 70}px`,
                minHeight: d.hours > 0 ? 4 : 0,
                backgroundImage: 'var(--grad-teal-purple)',
              }}
              title={`${DOW_LABEL[i]}: ${d.hours}h`}
            />
            <span className="text-[10px] font-medium text-muted">{DOW_LABEL[i]}</span>
          </div>
        ))}
      </div>
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

function ClassCard({ cls, index }) {
  const grade = cls.currentGrade;
  const glass = isGlassColor(cls.color);
  const gradient = classGradient(cls, index);
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="glass-card group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_22px_48px_-18px_rgba(180,120,80,0.45)]"
    >
      {/* Colored classes get a gradient wash + glowing blobs; "Glass / Clear"
          classes stay frosted (no color fill) with just the subtle accent bar. */}
      {!glass && (
        <>
          <span
            className="pointer-events-none absolute inset-0 opacity-[0.24] transition group-hover:opacity-[0.34]"
            style={{ backgroundImage: gradient }}
          />
          <span
            className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full opacity-80 blur-3xl transition group-hover:opacity-100"
            style={{ backgroundImage: gradient }}
          />
          <span
            className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full opacity-50 blur-3xl"
            style={{ backgroundImage: gradient }}
          />
        </>
      )}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-12 w-1.5 rounded-full"
            style={{ backgroundImage: classAccent(cls, index) }}
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

function ClassRow({ cls, index }) {
  const grade = cls.currentGrade;
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="group flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/40"
    >
      <span className="h-9 w-1.5 rounded-full" style={{ backgroundImage: classAccent(cls, index) }} />
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
    </Link>
  );
}

/* ---- "+" dropdown: Add Class · Add Activity ---------------------------- */
function AddMenu({ onAddActivity }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add"
        className="btn btn-primary grid h-10 w-10 place-items-center !p-0"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="glass-panel absolute right-0 z-30 mt-1 w-44 p-1.5 text-sm shadow-xl">
          <button type="button" role="menuitem" onClick={pick(() => navigate('/classes/new'))} className="menu-item">Add Class</button>
          <button type="button" role="menuitem" onClick={pick(onAddActivity)} className="menu-item">Add Activity</button>
        </div>
      )}
    </div>
  );
}

/* ---- Activity cards on the Dashboard (same look as classes, different link) --- */
const activityKindLabel = (k) => ACTIVITY_KINDS.find((x) => x.value === k)?.label || 'Activity';

function ActivityCard({ activity: a, index }) {
  const glass = isGlassColor(a.color);
  const gradient = classGradient(a, index);
  const overdue = activityOverdue(a);
  const { done, total, percent } = activityProjectProgress(a);
  return (
    <Link
      to={`/activities/${a.id}`}
      className="glass-card group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_22px_48px_-18px_rgba(180,120,80,0.45)]"
    >
      {!glass && (
        <>
          <span className="pointer-events-none absolute inset-0 opacity-[0.24] transition group-hover:opacity-[0.34]" style={{ backgroundImage: gradient }} />
          <span className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full opacity-80 blur-3xl transition group-hover:opacity-100" style={{ backgroundImage: gradient }} />
          <span className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full opacity-50 blur-3xl" style={{ backgroundImage: gradient }} />
        </>
      )}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="h-12 w-1.5 rounded-full" style={{ backgroundImage: classAccent(a, index) }} />
          <div>
            <h3 className="font-bold text-ink">{a.name}</h3>
            <p className="text-xs text-muted">{activityKindLabel(a.kind)}</p>
            {overdue > 0 && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                {overdue} overdue
              </span>
            )}
            {a.nextAction?.dueDate && overdue === 0 && (
              <p className={`mt-1 text-[11px] font-semibold ${countdownTone(dueStatus(a.nextAction.dueDate))}`}>
                Next: {dueStatus(a.nextAction.dueDate).countdownLabel}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold text-ink">{percent}%</div>
          <div className="text-xs font-medium text-muted">{done}/{total} project{total === 1 ? '' : 's'}</div>
        </div>
      </div>
      <p className="relative mt-4 flex gap-3 text-xs text-muted">
        <span className="truncate">{a.nextAction ? `Next: ${a.nextAction.title}` : total ? 'All steps done' : 'No steps yet'}</span>
      </p>
    </Link>
  );
}

function ActivityRow({ activity: a, index }) {
  const overdue = activityOverdue(a);
  const { done, total, percent } = activityProjectProgress(a);
  return (
    <Link to={`/activities/${a.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/40">
      <span className="h-9 w-1.5 rounded-full" style={{ backgroundImage: classAccent(a, index) }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{a.name}</span>
          {overdue > 0 && (
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">{overdue} overdue</span>
          )}
        </div>
        <div className="truncate text-xs text-muted">
          {activityKindLabel(a.kind)}
          {a.nextAction?.dueDate && overdue === 0 && (
            <span className={`ml-2 font-semibold ${countdownTone(dueStatus(a.nextAction.dueDate))}`}>· {dueStatus(a.nextAction.dueDate).countdownLabel}</span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-extrabold text-ink">{percent}%</div>
        <div className="text-[10px] font-medium text-muted">{done}/{total} projects</div>
      </div>
    </Link>
  );
}
