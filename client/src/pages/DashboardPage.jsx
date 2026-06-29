import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  gradeColor,
  classColor,
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">Your active classes this semester</p>
        </div>
        <Link
          to="/classes/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New class
        </Link>
      </div>

      {loading ? (
        <Spinner label="Loading classes…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Active classes" value={classes.length} />
            <Stat
              label="Current GPA"
              value={gpa == null ? '—' : gpa.toFixed(2)}
              valueClass="text-brand-700"
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
              <Link to="/classes/new" className="text-brand-600 hover:underline">
                Create your first class
              </Link>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
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

function Stat({ label, value, valueClass = 'text-slate-900' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
    </div>
  );
}

function ClassCard({ cls, index }) {
  const grade = cls.currentGrade;
  return (
    <Link
      to={`/classes/${cls.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-9 w-1.5 rounded-full"
            style={{ backgroundColor: classColor(cls, index) }}
          />
          <div>
            <h3 className="font-semibold text-slate-900">{cls.name}</h3>
            <p className="text-xs text-slate-500">
              {[cls.code, cls.term].filter(Boolean).join(' · ') || 'No code'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${gradeColor(grade?.percentage)}`}>
            {grade?.percentage != null ? `${grade.percentage}%` : '—'}
          </div>
          <div className="text-xs text-slate-400">
            {grade?.letter || 'No grades'}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        {grade?.gradedAssignments
          ? `${grade.gradedAssignments} graded`
          : 'No graded assignments yet'}
      </p>
    </Link>
  );
}
