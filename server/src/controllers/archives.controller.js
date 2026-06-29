import * as archiveService from '../services/archive.service.js';

export async function list(req, res) {
  const archives = await archiveService.listArchives(req.user.id);
  res.json({ archives });
}
