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
            <Stat label="Active classes" value={classes.length} />
            <Stat
              label="Current GPA"
              value={gpa == null ? '—' : gpa.toFixed(2)}
              gradient
            />
            <Stat
              label="Overall average"
              value={average == null ? '—' : `${average}%`}
              valueClass={gradeColor(average)}
            />
            <Stat label="Graded classes" value={graded.length} />
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

function Stat({ label, value, valueClass = 'text-ink', gradient = false }) {
  return (
    <div className="glass-card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-3xl font-extrabold ${gradient ? 'text-gradient' : valueClass}`}
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
      className="glass-card group relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_18px_40px_-16px_rgba(90,80,130,0.4)]"
    >
      {/* Soft organic gradient blob in the corner */}
      <span
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-30 blur-2xl transition group-hover:opacity-50"
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
      <p className="relative mt-4 text-xs text-muted">
        {grade?.gradedAssignments
          ? `${grade.gradedAssignments} graded`
          : 'No graded assignments yet'}
      </p>
    </Link>
  );
}
