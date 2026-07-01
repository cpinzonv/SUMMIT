import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { Modal, ErrorBanner } from './ui';

/**
 * "Forgot password?" dialog: collects an email, asks the server to send a reset
 * link, and shows a generic success message. The server never reveals whether
 * the email is registered, so we show the same confirmation regardless.
 */
export function ForgotPasswordModal({ initialEmail = '', onClose }) {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the reset link. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Reset your password" onClose={onClose}>
      {sent ? (
        <div className="space-y-4 text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          >
            <span aria-hidden>✓</span>
          </div>
          <div>
            <h4 className="text-base font-bold text-ink">Check your email for a reset link</h4>
            <p className="mt-1 text-sm text-muted">
              If an account exists for <span className="font-semibold text-ink">{email}</span>, we've
              sent a link to reset your password. It expires in 24 hours.
            </p>
          </div>
          <button onClick={onClose} className="btn btn-primary w-full">
            Got it
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted">
            Enter the email for your account and we'll send you a link to reset your password.
          </p>
          <ErrorBanner message={error} />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              autoFocus
              required
              className="field"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="btn btn-primary w-full"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </Modal>
  );
}
