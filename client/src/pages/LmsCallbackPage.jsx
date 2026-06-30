import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { Spinner, ErrorBanner } from '../components/ui';
import { lmsApi, lmsLabel, readPendingConnect, clearPendingConnect } from '../lib/lms';
import { gcalApi } from '../lib/gcal';

/**
 * An LMS redirects here (LMS_REDIRECT_URI) with ?code & ?state after the user
 * grants access. We recover which provider started the flow from the pending
 * record, validate state, exchange the code for tokens via the backend, then
 * return to Settings.
 */
export default function LmsCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');
  const [label, setLabel] = useState('your LMS');
  const ran = useRef(false); // guard against StrictMode double-invoke

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');
    const pending = readPendingConnect();
    clearPendingConnect();

    const provider = pending?.provider || 'canvas';
    const isGcal = provider === 'google_calendar';
    const providerLabel = isGcal ? 'Google Calendar' : lmsLabel(provider);
    setLabel(providerLabel);

    (async () => {
      if (oauthError) {
        setError(`${providerLabel} authorization was cancelled or failed (${oauthError}).`);
        return;
      }
      if (!code) {
        setError(`Missing authorization code from ${providerLabel}.`);
        return;
      }
      if (!pending || (state && pending.state && state !== pending.state)) {
        setError('Authorization could not be verified. Please try connecting again.');
        return;
      }
      try {
        if (isGcal) {
          await gcalApi.connect({ code, state });
          navigate('/settings?gcal=connected', { replace: true });
          return;
        }
        await lmsApi(provider).connect({ domain: pending.domain, code, state });
        await refreshUser();
        navigate(`/settings?lms=${provider}`, { replace: true });
      } catch (err) {
        setError(errorMessage(err, `Could not connect ${providerLabel}.`));
      }
    })();
  }, [navigate, refreshUser]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {error ? (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <button onClick={() => navigate('/settings')} className="btn btn-soft">
            Back to Settings
          </button>
        </div>
      ) : (
        <Spinner label={`Connecting ${label}…`} />
      )}
    </div>
  );
}
