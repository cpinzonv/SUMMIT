/**
 * LMS provider registry.
 *
 * Every provider implements this interface so the sync service stays
 * provider-agnostic — adding an LMS is "write one module + register it here":
 *
 *   name: string                      // canonical source key (matches providers.js)
 *   isConfigured(): boolean
 *   buildAuthUrl({ domain, redirectUri, state }): string
 *   exchangeCode({ domain, redirectUri, code }): Promise<Tokens>
 *   refresh({ domain, refreshToken }): Promise<Tokens>
 *   listCourses({ domain, accessToken }): Promise<Course[]>
 *   listAssignments({ domain, accessToken, externalCourseId }): Promise<Assignment[]>
 *
 * Shared shapes (what normalizers must return):
 *   Tokens     = { accessToken, refreshToken|null, expiresAt(ISO)|null }
 *   Course     = { externalId, name, code|null, term|null }
 *   Assignment = { externalId, title, dueDate(ISO)|null, pointValue|null,
 *                  description|null, url|null, grade:{pointsEarned,pointsPossible}|null }
 *
 * When a provider is in mock mode (global LMS_MOCK=true, or MOCK_<KEY>_MODE=true)
 * the in-memory fixture provider is used in its place, so the full pipeline runs
 * without credentials or network. Swapping in the real provider is an env change.
 */
import { providerUsesMock } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

import * as canvas from './canvas.js';
import * as blackboard from './blackboard.js';
import * as googleClassroom from './googleClassroom.js';
import { mockProvider } from './mock.js';

// Providers are registered here one at a time. Everything downstream (status,
// routes, the per-provider mock) keys off Object.keys(PROVIDERS), so adding a
// provider is a single edit: import the module and add it to this map.
const PROVIDERS = {
  canvas,
  blackboard,
  google_classroom: googleClassroom,
};

export const DEFAULT_PROVIDER = 'canvas';

/** All registered provider keys. */
export const PROVIDER_KEYS = Object.keys(PROVIDERS);

/**
 * Resolve a provider module by key, honoring mock mode. Throws 400 if unknown.
 * In mock mode the returned module reports `name === <key>` so stored
 * external_source rows stay consistent with the real provider.
 */
export function getProvider(providerName = DEFAULT_PROVIDER) {
  const real = PROVIDERS[providerName];
  if (!real) throw AppError.badRequest(`Unsupported LMS provider: ${providerName}`);
  if (providerUsesMock(providerName)) return mockProvider(providerName);
  return real;
}
