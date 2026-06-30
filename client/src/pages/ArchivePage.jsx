import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  gradeColor,
  classGradient,
} from '../components/ui';

export default function ArchivePage() {
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/api/archives')
      .then((res) => active && setArchives(res.data.archives))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Archives</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Past classes and semesters, snapshotted when archived
      </p>

      {loading ? (
        <Spinner label="Loading archives…" />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : archives.length === 0 ? (
        <EmptyState title="No archived classes yet">
          Archive a class from its detail page and it will appear here.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {archives.map((arc, i) => {
            const snap = arc.snapshot || {};
            const grade = snap.finalGrade;
            const count = snap.assignments?.length ?? 0;
            const gradient = classGradient(null, i);
            return (
              <div key={arc.id} className="glass-card relative overflow-hidden p-6">
                <span
                  className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl"
                  style={{ backgroundImage: gradient }}
                />
                <div className="relative flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-12 w-1.5 rounded-full" style={{ backgroundImage: gradient }} />
                    <div>
                      <h3 className="font-bold text-ink">
                        {snap.class?.name || arc.label}
                      </h3>
                      <p className="text-xs text-muted">
                        {[snap.class?.code, snap.class?.term].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-extrabold ${gradeColor(grade?.percentage)}`}>
                      {grade?.percentage != null ? `${grade.percentage}%` : '—'}
                    </div>
                    <div className="text-xs font-medium text-muted">
                      {grade?.letter || 'Final'}
                    </div>
                  </div>
                </div>
                <div className="relative mt-4 flex justify-between text-xs text-muted">
                  <span>{count} assignments</span>
                  <span>
                    Archived{' '}
                    {new Date(arc.archivedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
