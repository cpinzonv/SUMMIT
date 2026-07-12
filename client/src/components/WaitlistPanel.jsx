import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ErrorBanner } from './ui';
import { UNIVERSITIES } from '../data/universities';

/**
 * Shown on the register page while registration is invite_only: a calm
 * "launching soon" panel that collects waitlist signups instead of the form.
 * The university field is free-text with autocomplete suggestions — any value
 * the student types is accepted and stored as-is.
 */
export function WaitlistPanel() {
  const [email, setEmail] = useState('');
  const [university, setUniversity] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | done
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('submitting');
    try {
      await api.post('/api/auth/waitlist', {
        email: email.trim().toLowerCase(),
        ...(university.trim() ? { university: university.trim() } : {}),
        source: 'register_page',
      });
      setStatus('done');
    } catch (err) {
      setError(errorMessage(err, 'Could not add you to the list. Please try again in a moment.'));
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="glass-panel space-y-3 p-6 text-center">
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-full"
          style={{ backgroundImage: 'var(--grad-teal-purple)' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12.5l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 className="font-display text-xl font-bold text-ink">You&rsquo;re on the list</h2>
        <p className="text-sm text-muted">We&rsquo;ll email you first.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-panel space-y-4 p-6">
      <div className="space-y-1 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Launching August</p>
        <h2 className="font-display text-2xl font-bold leading-tight text-gradient">
          Your whole semester, handled.
        </h2>
        <p className="text-sm text-muted">First 500 students get Pro free for a year.</p>
      </div>

      <ErrorBanner message={error} />

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="you@school.edu"
          autoComplete="email"
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">Where do you study?</span>
        <input
          type="text"
          value={university}
          onChange={(e) => setUniversity(e.target.value)}
          className="field"
          placeholder="Start typing your university (optional)"
          list="waitlist-universities"
          autoComplete="off"
          maxLength={200}
        />
        <datalist id="waitlist-universities">
          {UNIVERSITIES.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </label>

      <button type="submit" disabled={status === 'submitting' || !email.trim()} className="btn btn-primary w-full">
        {status === 'submitting' ? 'Adding you…' : 'Join the waitlist'}
      </button>
    </form>
  );
}
