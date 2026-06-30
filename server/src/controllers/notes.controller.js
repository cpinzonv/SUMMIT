import { z } from 'zod';
import * as noteService from '../services/note.service.js';

export const createNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.string().optional(),
});

export const updateNoteSchema = z
  .object({
    title: z.string().max(300).optional(),
    content: z.string().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const noteIdParam = z.object({ noteId: z.string().uuid('Invalid note id') });
export const listQuery = z.object({ q: z.string().optional() });

export async function list(req, res) {
  const notes = await noteService.listNotes(req.user.id, req.params.id, req.query.q);
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
  res.status(204).end();
}

export async function search(req, res) {
  const notes = await noteService.searchNotes(req.user.id, req.query.q ?? '');
  res.json({ notes });
}
