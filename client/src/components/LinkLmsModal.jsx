import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Modal, ErrorBanner } from './ui';
import { LMS_META, lmsLabel } from '../lib/lms';

// The platforms a class can be linked to (order = dropdown order). Keys match
// the backend's LMS_PROVIDER_KEYS / linkLmsSchema.
const PLATFORMS = ['canvas', 'blackboard', 'google_classroom', 'brightspace', 'moodle', 'sakai'];

/**
 * Glassmorphic dialog to manually link ONE class to ONE LMS platform. Collects
 * a platform + that platform's course id/URL and POSTs to
 * /api/classes/:id/link-lms. Calls onLinked(updatedClass) on success.
 */
export function LinkLmsModal({ cls, onClose, onLinked }) {
  const [lms, setLms] = useState(cls.linkedLms || 'canvas');
  const [courseId, setCourseId] = useState(cls.linkedLmsCourseId || '');
  const [status, setStatus] = useState('idle'); // idle | saving | success
  const [error, setError] = useState('');

  const meta = LMS_META[lms] || {};

  const isCanvas = lms === 'canvas';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('saving');
    try {
      // Canvas verifies the connection server-side (checks the admin API key and
      // that the course resolves) before saving. Other platforms just store the
      // manual link for now.
      const { data } = isCanvas
        ? await api.post(`/api/classes/${cls.id}/link-canvas`, { course_id: courseId.trim() })
        : await api.post(`/api/classes/${cls.id}/link-lms`, { lms, course_id: courseId.trim() });
      setStatus('success');
      // Brief success beat, then hand the updated class back to the caller.
      setTimeout(() => onLinked?.(data.class), 800);
    } catch (err) {
      setError(
        errorMessage(
          err,
          isCanvas
            ? 'Could not connect to Canvas. Check the course ID and try again.'
            : 'Could not link this class. Please try again.',
        ),
      );
      setStatus('idle');
    }
  };

  return (
    <Modal title="Link to LMS" onClose={onClose}>
      {status === 'success' ? (
        <div className="space-y-4 text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl text-white"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          >
            <span aria-hidden>✓</span>
          </div>
          <div>
            <h4 className="text-base font-bold text-ink">
              {isCanvas ? `Connected to Canvas course ${courseId.trim()}` : `Linked to ${lmsLabel(lms)}`}
            </h4>
            <p className="mt-1 text-sm text-muted">
              <span className="font-semibold text-ink">{cls.name}</span> is now linked to course{' '}
              <span className="font-semibold text-ink">{courseId.trim()}</span>
              {isCanvas ? ' — the connection was verified.' : '.'}
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">
            Link <span className="font-semibold text-ink">{cls.name}</span> to one course in your
            learning platform.
          </p>
          <ErrorBanner message={error} />

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Select LMS platform</span>
            <select value={lms} onChange={(e) => setLms(e.target.value)} className="field">
              {PLATFORMS.map((key) => (
                <option key={key} value={key}>
                  {LMS_META[key]?.label || key}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Enter course ID or URL</span>
            <input
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              placeholder={meta.domainPlaceholder ? `e.g. 12345 or ${meta.domainPlaceholder}/courses/12345` : 'e.g. 12345'}
              className="field"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              required
            />
            <span className="mt-1 block text-xs text-muted">
              Find this in your {lmsLabel(lms)} course — it's the course ID or the page URL.
            </span>
          </label>

          <button
            type="submit"
            disabled={status === 'saving' || !courseId.trim()}
            className="btn btn-primary flex w-full items-center justify-center gap-2"
          >
            {status === 'saving' && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {status === 'saving'
              ? isCanvas
                ? 'Verifying with Canvas…'
                : 'Connecting…'
              : 'Connect'}
          </button>
        </form>
      )}
    </Modal>
  );
}
