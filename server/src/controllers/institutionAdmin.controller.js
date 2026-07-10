import { z } from 'zod';
import * as inst from '../services/institution.service.js';
import { logAudit } from '../services/audit.service.js';

/**
 * Institution-admin (school IT) endpoints. Every handler is scoped to
 * req.institutionId (set by requireInstitutionAdmin) — never a client value —
 * so an admin can only ever see/manage their own institution's roster.
 */

export const rosterSchema = z.object({
  students: z
    .array(z.object({ email: z.string().email(), name: z.string().max(200).optional() }))
    .min(1, 'Add at least one student')
    .max(2000, 'Up to 2000 students per upload'),
});

export async function overview(req, res) {
  const [institution, students] = await Promise.all([
    inst.getInstitution(req.institutionId),
    inst.listStudents(req.institutionId),
  ]);
  res.json({ institution, students });
}

export async function uploadRoster(req, res) {
  // { created: [{ email, inviteToken }], skipped: [{ email, reason }] }
  const result = await inst.addStudents(req.institutionId, req.body.students);
  logAudit(req, {
    action: 'admin.roster_add',
    targetType: 'institution',
    targetId: req.institutionId,
    tenantId: req.institutionId,
    metadata: { created: result.created?.length ?? 0, skipped: result.skipped?.length ?? 0 },
  });
  res.json(result);
}
