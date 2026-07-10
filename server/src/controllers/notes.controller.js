import { z } from 'zod';
import * as noteService from '../services/note.service.js';
import { askAboutNotes } from '../services/chatbot.service.js';
import { logAudit } from '../services/audit.service.js';

export const createNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.string().optional(),
  transcriptId: z.string().uuid().nullable().optional(),
});

export const chatbotSchema = z.object({
  question: z.string().min(1, 'Ask a question').max(2000),
});

export async function chatbot(req, res) {
  const result = await askAboutNotes(req.user.id, req.params.id, req.body.question);
  res.json(result);
}

export const updateNoteSchema = z
  .object({
    title: z.string().max(300).optional(),
    content: z.string().optional(),
    archived: z.boolean().optional(),
    transcriptId: z.string().uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const noteIdParam = z.object({ noteId: z.string().uuid('Invalid note id') });
export const listQuery = z.object({
  q: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
});

export async function list(req, res) {
  const notes = await noteService.listNotes(req.user.id, req.params.id, req.query.q, {
    archived: req.query.archived === 'true',
  });
  logAudit(req, {
    action: 'record.view',
    targetType: 'note',
    targetId: req.params.id,
    subjectStudentId: req.user.id,
    metadata: { scope: 'class-list', count: notes.length },
  });
  res.json({ notes });
}

export async function create(req, res) {
  const note = await noteService.createNote(req.user.id, req.params.id, req.body);
  res.status(201).json({ note });
}

export async function update(req, res) {
  const note = await noteService.updateNote(req.user.id, req.params.noteId, req.body);
  res.json({ note });
}

export async function remove(req, res) {
  await noteService.deleteNote(req.user.id, req.params.noteId);
  logAudit(req, {
    action: 'record.delete',
    targetType: 'note',
    targetId: req.params.noteId,
    subjectStudentId: req.user.id,
  });
  res.status(204).end();
}

export async function search(req, res) {
  const notes = await noteService.searchNotes(req.user.id, req.query.q ?? '');
  // Cross-class note search — a bulk read. Log the count only, never the query text.
  logAudit(req, {
    action: 'record.view',
    targetType: 'note',
    subjectStudentId: req.user.id,
    metadata: { scope: 'search', count: notes.length },
  });
  res.json({ notes });
}
