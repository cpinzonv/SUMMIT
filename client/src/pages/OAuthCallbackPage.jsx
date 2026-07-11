import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullPageSpinner } from '../components/ui';

/**
 * Landing page for the OAuth redirect. The backend bounces the browser here with
 * either tokens or an error in the URL FRAGMENT (#accessToken=…&refreshToken=… or
 * #error=code). We parse the fragment, store the tokens, and head to the
 * dashboard — or send the user back to /login with a readable message.
 */
const ERROR_MESSAGES = {
  access_denied: 'You cancelled the sign-in, or access was denied.',
  provider_unavailable: 'That sign-in option isn’t available right now.',
  invalid_state: 'Your sign-in session expired. Please try again.',
  no_email: 'Your account didn’t share an email address, which Summit needs.',
  email_unverified: 'Your email isn’t verified with that provider, so we can’t sign you in.',
  oauth_failed: 'We couldn’t complete sign-in with that provider. Please try again.',
  token_error: 'Something went wrong finishing sign-in. Please try again.',
};

export default function OAuthCallbackPage() {
  const { loginWithTokens } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const ran = useRef(false); // guard StrictMode's double-invoke

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    // Clear the fragment so tokens don't linger in the address bar / history.
    window.history.replaceState(null, '', window.location.pathname);

    const errCode = params.get('error');
    if (errCode) {
      navigate('/login', { replace: true, state: { oauthError: ERROR_MESSAGES[errCode] || 'Sign-in failed.' } });
      return;
    }

    // 2FA-enabled account: the backend sent a challenge instead of tokens. Hand
    // off to the normal login 2FA prompt (same flow as password login).
    const challengeToken = params.get('challengeToken');
    if (params.get('twoFactorRequired') && challengeToken) {
      navigate('/login', { replace: true, state: { twoFactor: { challengeToken } } });
      return;
    }

    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    if (!accessToken || !refreshToken) {
      navigate('/login', { replace: true, state: { oauthError: 'Sign-in failed.' } });
      return;
    }

    loginWithTokens({ accessToken, refreshToken })
      .then(() => navigate('/', { replace: true }))
      .catch(() => {
        setError('Could not load your account. Please try signing in again.');
        setTimeout(() => navigate('/login', { replace: true }), 1500);
      });
  }, [loginWithTokens, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-muted">
        {error}
      </div>
    );
  }
  return <FullPageSpinner />;
}
