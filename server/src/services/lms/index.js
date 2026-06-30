/**
 * LMS provider registry.
 *
 * Every provider implements this interface so the sync service stays
 * provider-agnostic (add Blackboard/Brightspace/Moodle by writing one module
 * and registering it here):
 *
 *   name: string
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
 * When LMS_MOCK=true the mock provider is used for every provider name, so the
 * full pipeline runs without credentials or network.
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import * as canvas from './canvas.js';
import * as mock from './mock.js';

const PROVIDERS = { canvas };

export const DEFAULT_PROVIDER = 'canvas';

/** Resolve a provider module by name (honoring LMS_MOCK). Throws 400 if unknown. */
export function getProvider(providerName = DEFAULT_PROVIDER) {
  if (env.lms.useMock) return mock;
  const provider = PROVIDERS[providerName];
  if (!provider) throw AppError.badRequest(`Unsupported LMS provider: ${providerName}`);
  return provider;
}
