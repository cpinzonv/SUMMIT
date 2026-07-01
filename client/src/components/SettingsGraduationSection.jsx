import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner, Toast } from './ui';

/**
 * Graduation requirements editor for the Settings page. Reads the user's
 * total credits-to-graduate (default 120) and an optional per-semester target,
 * then persists them via PATCH /api/user/graduation-settings. On save it
 * refreshes the auth user so the Planner's climb-to-graduation goal updates.
 */
export default function SettingsGraduationSection() {
  const { refreshUser } = useAuth();
  const [graduationCredits, setGraduationCredits] = useState('120');
  const [semesterCredits, setSemesterCredits] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Fetch current values on mount.
  useEffect(() => {
    let active = true;
    api
      .get('/api/user/graduation-settings')
      .then(({ data }) => {
        if (!active) return;
        setGraduationCredits(String(data.graduationCredits ?? 120));
        setSemesterCredits(data.semesterCredits == null ? '' : String(data.semesterCredits));
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Auto-clear the toast.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const gradNum = Number(graduationCredits);
  const semNum = semesterCredits.trim() === '' ? null : Number(semesterCredits);
  const gradValid = Number.isInteger(gradNum) && gradNum > 0;
  const semValid = semNum == null || (Number.isInteger(semNum) && semNum > 0);
  const canSave = gradValid && semValid && !saving;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!gradValid || !semValid) return;
    setSaving(true);
    try {
      const { data } = await api.patch('/api/user/graduation-settings', {
        graduationCredits: gradNum,
        semesterCredits: semNum,
      });
      setGraduationCredits(String(data.graduationCredits));
      setSemesterCredits(data.semesterCredits == null ? '' : String(data.semesterCredits));
      await refreshUser();
      setToast({ type: 'success', msg: 'Graduation requirements saved' });
    } catch (err) {
      setError(errorMessage(err, 'Could not save graduation requirements.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-card mb-5 p-6">
      <h2 className="font-display text-lg font-bold text-ink">Graduation</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted">
        Set the credits you need to graduate — the Planner tracks your climb against this goal.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <form onSubmit={save} className="space-y-4">
          {error && <ErrorBanner message={error} />}

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Total credits to graduate</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={graduationCredits}
              onChange={(e) => setGraduationCredits(e.target.value)}
              className="field !w-40"
            />
            {!gradValid && (
              <span className="mt-1 block text-xs font-medium text-rose-500">Must be a positive number</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Credits per semester <span className="font-normal text-muted">(optional)</span>
            </span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="e.g. 15"
              value={semesterCredits}
              onChange={(e) => setSemesterCredits(e.target.value)}
              className="field !w-40"
            />
            {!semValid && (
              <span className="mt-1 block text-xs font-medium text-rose-500">Must be a positive number</span>
            )}
            <span className="mt-1 block text-xs text-muted">Used to break your goal down by term.</span>
          </label>

          <button type="submit" disabled={!canSave} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      <Toast toast={toast} />
    </section>
  );
}
