/**
 * SSRF guard for server-side outbound fetches to user-influenced hosts (e.g. a
 * student's Canvas domain). Two layers, per SECURITY_AUDIT_2 H2:
 *
 *   1. assertSafeHost(host) — reject IP literals, bare/internal hostnames, and
 *      reserved TLDs (.internal/.local/.corp/.lan/…) before any network call.
 *   2. ssrfSafeAgent — an undici dispatcher whose DNS lookup validates that EVERY
 *      resolved address is public and connects only to a validated address, so a
 *      name that resolves (or DNS-rebinds) to a private/reserved/link-local IP is
 *      blocked at connect time — the layer step 1 can't catch.
 *
 * Pass `{ dispatcher: ssrfSafeAgent }` to every such fetch, and call
 * assertSafeHost() on the URL's hostname first.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { AppError } from './AppError.js';

// Hostnames / suffixes that must never be reached, regardless of resolution.
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.corp', '.lan', '.home', '.intranet'];
const BLOCKED_EXACT = new Set(['localhost']);

/** True if an IP string is private / reserved / loopback / link-local / ULA. */
export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-net / private / loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase().split('%')[0]; // strip zone id
    if (low === '::1' || low === '::') return true; // loopback / unspecified
    if (low.startsWith('fe80')) return true; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA fc00::/7
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // unknown format → block
}

/** Reject IP literals, bare/internal hostnames, and reserved TLDs. Sync — no DNS. */
export function assertSafeHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) throw AppError.badRequest('A host is required.');
  if (net.isIP(h)) throw AppError.badRequest('Enter a domain name, not an IP address.');
  if (BLOCKED_EXACT.has(h)) throw AppError.badRequest('That host is not allowed.');
  // Must be a dotted, public-looking FQDN (letters TLD ≥ 2). Blocks "localhost",
  // single-label hostnames, and trailing-dot tricks.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(h)) {
    throw AppError.badRequest('Enter a valid public domain.');
  }
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) {
    throw AppError.badRequest('That host is not allowed.');
  }
  return h;
}

// A DNS lookup for undici that validates every resolved address is public and
// connects only to a validated one — defeats DNS-rebinding (validate == connect).
function validatingLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (isBlockedIp(a.address)) {
        return callback(Object.assign(new Error('Blocked: host resolves to a non-public address'), { code: 'ERR_SSRF_BLOCKED' }));
      }
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

/** Shared dispatcher: pass as `{ dispatcher: ssrfSafeAgent }` to guarded fetches. */
export const ssrfSafeAgent = new Agent({ connect: { lookup: validatingLookup } });

/**
 * fetch() bound to the SSRF-safe dispatcher. Uses undici's OWN fetch — NOT the
 * global fetch — so the dispatcher and the fetch implementation are the same
 * undici version. The global fetch is Node's *bundled* undici, whose dispatcher
 * interface can differ from a userland Agent (mismatch → "invalid onError
 * method"). undici is pinned in package.json to a major that both imports on the
 * deploy's Node runtime and matches this Agent (see that pin before bumping it).
 */
export const safeFetch = (url, opts = {}) => undiciFetch(url, { ...opts, dispatcher: ssrfSafeAgent });
