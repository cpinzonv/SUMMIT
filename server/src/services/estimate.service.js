/**
 * AI time estimation for an assignment — asks Claude how long the described work
 * would take an average student, returns whole minutes. Reuses ANTHROPIC_API_KEY
 * (like the notes chatbot / flashcards); 503s when unset. The caller persists the
 * result to assignments.estimated_hours (decimal hours).
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let client;
function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(503, 'Time estimation is not configured. Set ANTHROPIC_API_KEY in the server environment.');
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

// Strip HTML to plain text and bound the size so we stay well within the context.
function toPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

/**
 * Estimate how long the assignment described by `instructions` (HTML or text)
 * takes an average student. Returns { minutes } — a positive integer.
 */
export async function estimateMinutes({ title, instructions }) {
  const text = toPlainText(instructions);
  if (text.length < 10) {
    throw new AppError(400, 'Add some instructions first so we can estimate the time.', { code: 'too_short' });
  }

  const system =
    'You estimate how long a school/college assignment takes an AVERAGE student of ' +
    'typical ability to complete, from start to finish. Account for reading, thinking, ' +
    'drafting, and revising. Reply with ONLY a JSON object of the form {"minutes": <integer>} ' +
    'and nothing else. Minutes must be a positive whole number. If the task is vague, give ' +
    'your best reasonable estimate rather than refusing.';

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 128,
      system,
      messages: [
        {
          role: 'user',
          content: `Assignment title: ${title || '(untitled)'}\n\nInstructions:\n${text}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `Time estimate failed: ${err?.message || 'unknown error'}`);
  }

  const raw = message.content?.find((b) => b.type === 'text')?.text ?? '';
  const match = raw.match(/\{[^}]*"minutes"\s*:\s*(\d+)[^}]*\}/);
  const minutes = match ? parseInt(match[1], 10) : NaN;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new AppError(502, 'Could not read a time estimate from the model. Try again.');
  }
  // Clamp to a sane range (1 minute … 200 hours).
  return { minutes: Math.min(minutes, 200 * 60) };
}
