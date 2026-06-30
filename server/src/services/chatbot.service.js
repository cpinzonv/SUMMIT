/**
 * Class-notes chatbot — answers a student's question grounded ONLY in their own
 * notes for a class, via the Claude API (reuses the ANTHROPIC_API_KEY the
 * syllabus feature uses). Returns 503 when the key is unset, a typed 400 when the
 * class has no notes yet, and guards the prompt size to stay within token limits.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { listNotes } from './note.service.js';

let client;
function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(
      503,
      'The notes chatbot is not configured. Set ANTHROPIC_API_KEY in the server environment.',
    );
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

// Keep the notes context bounded so we don't blow the context window. ~80k chars
// is a safe budget well under the model's limit, leaving room for the answer.
const MAX_NOTES_CHARS = 80000;

function buildNotesContext(notes) {
  let out = '';
  let truncated = false;
  for (const n of notes) {
    const block = `\n\n## ${n.title || 'Untitled note'}\n${n.content || ''}`;
    if (out.length + block.length > MAX_NOTES_CHARS) {
      truncated = true;
      break;
    }
    out += block;
  }
  return { context: out.trim(), truncated };
}

export async function askAboutNotes(userId, classId, question) {
  const cls = await getOwnedClass(userId, classId); // 404s if not owned
  const notes = await listNotes(userId, classId, '');

  if (!notes.length) {
    throw new AppError(400, 'Upload notes first to use the chatbot.', { code: 'no_notes' });
  }

  const { context, truncated } = buildNotesContext(notes);
  const system =
    `You are a tutor helping a student understand their "${cls.name}" class. ` +
    `Here are the student's class notes:\n${context}\n\n` +
    `Answer the student's question based ONLY on these notes. If the answer isn't in ` +
    `the notes, say so plainly and suggest what they might add. Be concise and clear.` +
    (truncated ? ' (Note: only part of the notes fit in context.)' : '');

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: question }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) {
      throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    }
    throw new AppError(502, `Chatbot request failed: ${err?.message || 'unknown error'}`);
  }

  const answer = message.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  return { answer, noteCount: notes.length, truncated };
}
