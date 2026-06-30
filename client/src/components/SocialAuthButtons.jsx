import { useEffect, useState } from 'react';
import { api, API_URL } from '../api/client';

/**
 * Social-login buttons (Google / Apple / GitHub). Only the providers the server
 * has credentials for are shown (GET /api/auth/providers). Clicking a button
 * sends the browser to the backend's OAuth initiator, which redirects to the
 * provider; the flow returns to /auth/callback with tokens in the URL fragment.
 */

// Brand logos as inline SVG (no external requests). currentColor where it suits
// a monochrome mark; Google keeps its four-color glyph.
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.78c.02 2.34 2.05 3.12 2.08 3.13-.02.06-.33 1.12-1.08 2.21-.65.95-1.32 1.9-2.39 1.92-1.04.02-1.38-.62-2.57-.62-1.2 0-1.57.6-2.56.64-1.02.04-1.8-1.03-2.46-1.98-1.34-1.94-2.37-5.48-.99-7.87.68-1.19 1.91-1.94 3.24-1.96 1-.02 1.96.68 2.57.68.62 0 1.78-.84 3-.71.51.02 1.95.2 2.87 1.55-.07.05-1.72 1-1.7 3zM14.4 5.27c.55-.67.92-1.6.82-2.52-.79.03-1.75.53-2.32 1.19-.51.59-.96 1.53-.84 2.43.88.07 1.78-.45 2.34-1.1z" />
    </svg>
  );
}
function GitHubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}

const META = {
  google: { label: 'Continue with Google', Logo: GoogleLogo, className: 'oauth-btn oauth-google' },
  apple: { label: 'Continue with Apple', Logo: AppleLogo, className: 'oauth-btn oauth-apple' },
  github: { label: 'Continue with GitHub', Logo: GitHubLogo, className: 'oauth-btn oauth-github' },
};
const ORDER = ['google', 'apple', 'github'];

export function SocialAuthButtons() {
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .get('/api/auth/providers')
      .then((res) => alive && setProviders(res.data.providers || []))
      .catch(() => alive && setProviders([]));
    return () => {
      alive = false;
    };
  }, []);

  // While loading, or when no provider is configured, render nothing (no empty
  // divider). This keeps the email form clean until OAuth is actually set up.
  if (!providers || providers.length === 0) return null;

  const visible = ORDER.filter((p) => providers.includes(p));

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {visible.map((p) => {
          const { label, Logo, className } = META[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                window.location.href = `${API_URL}/api/auth/${p}`;
              }}
              className={className}
            >
              <Logo />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-xs font-medium text-muted">
        <span className="h-px flex-1 bg-white/50" />
        Or continue with email
        <span className="h-px flex-1 bg-white/50" />
      </div>
    </div>
  );
}
