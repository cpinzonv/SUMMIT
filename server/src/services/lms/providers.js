/**
 * Canonical LMS provider registry (metadata only — the executable provider
 * modules live next to this file and are wired up in ./index.js).
 *
 * Everything that needs to enumerate providers (env config, route mounting,
 * request validation, the per-provider mock) imports LMS_PROVIDER_KEYS from here
 * so there is exactly one source of truth. A provider's `key` is used verbatim
 * as:
 *   - the value stored in users/classes/assignments `external_source`
 *   - the `lms_connections.provider` discriminator
 *   - the URL path segment (e.g. POST /api/blackboard/sync)
 *   - the env var stem (CANVAS_*, GOOGLE_CLASSROOM_*, MOCK_<KEY>_MODE, ...)
 *
 * Keys are snake_case so they are safe in URLs, env names, and SQL alike.
 */

export const LMS_PROVIDERS = [
  {
    key: 'canvas',
    label: 'Canvas',
    // Per-institution host the user authenticates against (multi-tenant LMS).
    needsDomain: true,
    domainLabel: 'Canvas web address',
    domainPlaceholder: 'school.instructure.com',
    color: '#e2410b',
  },
  {
    key: 'blackboard',
    label: 'Blackboard',
    needsDomain: true,
    domainLabel: 'Blackboard web address',
    domainPlaceholder: 'blackboard.school.edu',
    color: '#1c1c1c',
  },
  {
    key: 'google_classroom',
    label: 'Google Classroom',
    // Google is single-tenant (accounts.google.com) — no per-school host.
    needsDomain: false,
    domainLabel: null,
    domainPlaceholder: null,
    color: '#1a73e8',
  },
  {
    key: 'brightspace',
    label: 'Brightspace',
    needsDomain: true,
    domainLabel: 'Brightspace web address',
    domainPlaceholder: 'school.brightspace.com',
    color: '#ff6b00',
  },
  {
    key: 'moodle',
    label: 'Moodle',
    needsDomain: true,
    domainLabel: 'Moodle site address',
    domainPlaceholder: 'moodle.school.edu',
    color: '#f98012',
  },
  {
    key: 'sakai',
    label: 'Sakai',
    needsDomain: true,
    domainLabel: 'Sakai site address',
    domainPlaceholder: 'sakai.school.edu',
    color: '#1d6fb8',
  },
];

export const LMS_PROVIDER_KEYS = LMS_PROVIDERS.map((p) => p.key);

export function getProviderMeta(key) {
  return LMS_PROVIDERS.find((p) => p.key === key) || null;
}

export function isProviderKey(key) {
  return LMS_PROVIDER_KEYS.includes(key);
}

/** Translate a provider key into its env var stem, e.g. google_classroom → GOOGLE_CLASSROOM. */
export function envStem(key) {
  return key.toUpperCase();
}
