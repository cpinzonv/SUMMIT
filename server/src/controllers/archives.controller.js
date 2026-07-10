import * as archiveService from '../services/archive.service.js';
import { logAudit } from '../services/audit.service.js';

export async function list(req, res) {
  const archives = await archiveService.listArchives(req.user.id);
  // Archives are point-in-time snapshots of full class records (incl. grades).
  logAudit(req, {
    action: 'record.export',
    targetType: 'archive',
    subjectStudentId: req.user.id,
    metadata: { scope: 'list', count: archives.length },
  });
  res.json({ archives });
}
