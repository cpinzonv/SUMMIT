import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  gradeColor,
  classGradient,
  computeGpa,
} from '../components/ui';

export default function DashboardPage() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/api/classes')
      .then((res) => active && setClasses(res.data.classes))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

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
            Your active classes this semester
          </p>
        </div>
        <Link to="/classes/new" className="btn btn-primary">
          + New class
        </Link>
      </div>

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
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {classes.map((cls, i) => (
                <ClassCard key={cls.id} cls={cls} index={i} />
              ))}
            </div>
          )}
        </>
      )}
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
  const gradient = classGradient(cls, index);
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="glass-card group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_22px_48px_-18px_rgba(180,120,80,0.45)]"
    >
      {/* Unique gradient wash tinting the whole card */}
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.16] transition group-hover:opacity-25"
        style={{ backgroundImage: gradient }}
      />
      {/* Soft organic gradient glow in the corner */}
      <span
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-60 blur-2xl transition group-hover:opacity-80"
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
