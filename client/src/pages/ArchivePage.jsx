import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  gradeColor,
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
      <h1 className="text-2xl font-bold">Archives</h1>
      <p className="mb-6 text-sm text-slate-500">
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
        <div className="grid gap-4 sm:grid-cols-2">
          {archives.map((arc) => {
            const snap = arc.snapshot || {};
            const grade = snap.finalGrade;
            const count = snap.assignments?.length ?? 0;
            return (
              <div
                key={arc.id}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {snap.class?.name || arc.label}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {[snap.class?.code, snap.class?.term]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-xl font-bold ${gradeColor(
                        grade?.percentage,
                      )}`}
                    >
                      {grade?.percentage != null ? `${grade.percentage}%` : '—'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {grade?.letter || 'Final'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex justify-between text-xs text-slate-400">
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
