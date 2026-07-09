# Security Audit — Institutional Readiness

_Date: 2026-07-09 · Scope: full-stack (Node/Express API + React SPA) · Branch: `feat/security-audit`_

This audit reviewed all 13 requested areas. The codebase was already strong on
the fundamentals (parameterized SQL, bcrypt, Bearer-token auth with DB-side
authorization, prod error masking, helmet, 0 dependency vulnerabilities). The
gaps were concentrated in **rate limiting**, **upload type validation**, and
**audit logging** — all now fixed on this branch — plus a few hardening
recommendations that are configuration/product decisions rather than defects.

## Summary

| # | Area | Status | Severity of gap |
|---|------|--------|-----------------|
| 1 | Input validation & injection | ✅ Pass (verified) | — |
| 2 | XSS protection | ✅ Pass + hardened (DOMPurify added) | Low |
| 3 | CSRF | ✅ N/A by design (Bearer tokens, not cookies) | — |
| 4 | Rate limiting | ✅ **Fixed** | High |
| 5 | Password security | ✅ Pass | — |
| 6 | JWT token security | ✅ Pass (1 config recommendation) | Low |
| 7 | API auth / tenant isolation | ✅ Pass (verified) | — |
| 8 | Error handling | ✅ Pass | — |
| 9 | Secure headers | ✅ **Fixed** (X-Frame-Options DENY, explicit HSTS) | Medium |
| 10 | Dependency scanning | ✅ Pass (0 vulns, server + client) | — |
| 11 | 2FA security | ✅ Pass + **rate-limited** (1 recommendation) | Medium |
| 12 | File upload validation | ✅ **Fixed** (MIME whitelist + 25 MB cap) | Medium |
| 13 | Logging & monitoring | ✅ **Fixed** (security_events audit trail) | Medium |

---

## Findings & fixes

### 1. Input validation & injection — PASS
- **SQL injection:** every query uses parameterized `$n` placeholders. Dynamic
  SQL fragments (`SET ${sets.join(',')}`, `${cfg.idCol}`) are built only from
  **fixed server-side column whitelists** and provider maps — never from user
  input. No string-concatenated user data reaches SQL.
- **Server-side validation:** all mutating routes run Zod schemas via the
  `validate` middleware; the client is never trusted.
- **Command injection:** one `execFile('node', [staticScript])` in the
  admin-only seed route — no shell, no user input in args.
- **No fix required.**

### 2. XSS — PASS, hardened
- User rich text goes through TipTap (re-parsed via its schema, dropping active
  content) or the Markdown renderer, which **escapes HTML first** and only then
  applies a fixed set of formatting transforms; links are constrained to
  `http(s)`/relative.
- **Added (defense-in-depth):** `client/src/utils/sanitize.js` (DOMPurify) now
  wraps every `dangerouslySetInnerHTML` render. This also protects the converted-
  DOCX preview (PR #42) — that view should call `sanitizeHtml()`.
- CSP is set by helmet (`default-src 'self'`, `object-src 'none'`, …).

### 3. CSRF — N/A by design
The API is **stateless and token-based**: access tokens live in `localStorage`
and are sent in the `Authorization: Bearer` header, not cookies. A cross-site
request cannot read `localStorage` or set that header, so classic CSRF does not
apply, and adding `csurf` would break the stateless design. OAuth uses a signed,
short-lived `state` token to protect its redirect. **No fix required.**

### 4. Rate limiting — FIXED (was High)
Previously **absent**. Added `express-rate-limit` (`middleware/rateLimit.js`)
with `app.set('trust proxy', 1)` so limits key on the real client IP behind
Railway:
- **Global:** 600 requests / 15 min per IP across `/api`.
- **Sensitive (5 / min):** login, `login/2fa`, forgot-password, reset-password,
  change-password, 2FA confirm/disable.
- **Auth (20 / 10 min):** register, verify-email, resend-verification.
- Verified: the 6th login attempt in a minute returns **HTTP 429**.

### 5. Password security — PASS
- bcrypt with `SALT_ROUNDS = 12` (≥ 10). No plaintext anywhere; hashes never
  returned to clients.
- Password-reset codes are bcrypt-hashed, single-use, **10-minute** TTL,
  attempt-limited (stricter than the 1-hour requirement).

### 6. JWT — PASS (recommendation)
- Access tokens are short-lived (`ACCESS_TOKEN_TTL`, default 15 min). Refresh
  tokens are opaque 48-byte randoms, **SHA-256-hashed in the DB** (a DB leak
  yields no usable tokens), and **revoked on logout** (and on password reset).
- Secrets are `required()` at boot — the server refuses to start without them;
  nothing is hardcoded.
- Authorization role is read from the **DB per request**, not embedded in the
  JWT, so a demotion/ban takes effect immediately (stronger than a role claim).
- **Recommendation (Low):** default refresh TTL is 30 days; set
  `REFRESH_TOKEN_TTL_DAYS=7` for institutional tenants, and consider refresh-token
  rotation.

### 7. API auth / tenant isolation — PASS
- Every protected route is behind `requireAuth`; handlers scope queries to
  `req.user.id`.
- `adminOnly` and `requireInstitutionAdmin` load role from the DB and **stamp
  `req.institutionId` from the DB, never the request** — institution tenants are
  isolated server-side. Resource access uses ownership joins
  (`getOwnedClass`, `getOwnedAssignment`, files by `user_id`).
- The unauthenticated `/bootstrap` endpoint requires a `SETUP_TOKEN` **and**
  only works while no admin exists.

### 8. Error handling — PASS
Central error handler returns the app's `{ error: { message } }` shape; in
production, unexpected errors are masked to `"Internal server error"` (full
detail logged server-side only). No stack traces or SQL errors reach clients.

### 9. Secure headers — FIXED (was Medium)
helmet was already enabled. Hardened its config:
- `X-Frame-Options: DENY` (was helmet's default `SAMEORIGIN`) — clickjacking.
- Explicit **HSTS** `max-age=31536000; includeSubDomains; preload`.
- Retained: CSP, `X-Content-Type-Options: nosniff`, `X-Powered-By` removed.
- HTTPS redirection is handled at the platform edge (Railway/Vercel).

### 10. Dependency scanning — PASS
`npm audit` reports **0 vulnerabilities** on both `server/` and `client/`.

### 11. 2FA — PASS, rate-limited (recommendation)
- TOTP secret and backup codes are **encrypted at rest** with
  `APP_ENCRYPTION_KEY` (`utils/crypto`). Setup stores a pending secret; confirm
  enables and returns 10 one-time backup codes.
- **Added:** the strict limiter now throttles `login/2fa` and 2FA confirm/disable
  (code-guessing surface).
- **Recommendation (Medium):** store backup codes **hashed** (bcrypt) rather than
  encrypted, matching password handling, so even the encryption key can't reveal
  them.

### 12. File upload validation — FIXED (was Medium)
- Class uploads already had MIME whitelists + size caps; **assignment instruction
  files and submissions did not.** Added `utils/uploads.js` (`documentUpload`):
  a MIME + extension whitelist (PDF, Office docs, images, text/CSV) and a **25 MB**
  cap; executables/HTML/SVG are rejected. Verified: `.exe` → 400, `.pdf` → 201.
- Files are stored as base64 **in the DB (never on a filesystem path)**, so path
  traversal is not possible; downloads set `Content-Disposition` with an
  encoded filename (no header injection).

### 13. Logging & monitoring — FIXED (was Medium)
- Added an append-only `security_events` table + `audit.service.logSecurityEvent`
  (best-effort, never throws, **never logs passwords/tokens/codes**).
- Wired into: login **success and failure**, password change, password reset,
  2FA enable/disable — each with timestamp, user id/email, IP, and outcome.
- Verified: 5 failed logins recorded (the rate-limited 6th correctly wrote no
  row); a successful login recorded a `success` row.

---

## Recommendations (not blocking)

| Priority | Item | Notes |
|----------|------|-------|
| Medium | Hash 2FA backup codes | Move from encrypted to bcrypt-hashed (see #11). |
| Low | Shorten refresh TTL | `REFRESH_TOKEN_TTL_DAYS=7` for tenants; add rotation. |
| Low | Constant-time setup-token compare | Use `crypto.timingSafeEqual` in `/bootstrap`. |
| Low | Disable `/admin/seed-database` in prod | Guard behind `NODE_ENV !== 'production'`. |
| Low | Optional AV scanning on uploads | ClamAV/VirusTotal if institutional policy requires it. |
| Low | Ship a security-events admin view | Surface the new audit trail in the admin console. |

## Operational checklist (deploy-time)

- [ ] Set `REFRESH_TOKEN_TTL_DAYS=7` (recommended for tenants).
- [ ] Confirm `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENCRYPTION_KEY`,
      `SETUP_TOKEN` are set and strong in Railway.
- [ ] Confirm the platform forces HTTPS and the CORS allowlist
      (`CORS_ORIGINS`) matches production origins only.
