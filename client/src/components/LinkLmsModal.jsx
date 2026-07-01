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

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('saving');
    try {
      const { data } = await api.post(`/api/classes/${cls.id}/link-lms`, {
        lms,
        course_id: courseId.trim(),
      });
      setStatus('success');
      // Brief success beat, then hand the updated class back to the caller.
      setTimeout(() => onLinked?.(data.class), 700);
    } catch (err) {
      setError(errorMessage(err, 'Could not link this class. Please try again.'));
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
            <h4 className="text-base font-bold text-ink">Linked to {lmsLabel(lms)}</h4>
            <p className="mt-1 text-sm text-muted">
              <span className="font-semibold text-ink">{cls.name}</span> is now linked to course{' '}
              <span className="font-semibold text-ink">{courseId.trim()}</span>.
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
            className="btn btn-primary w-full"
          >
            {status === 'saving' ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}
    </Modal>
  );
}
