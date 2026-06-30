/**
 * Shared Claude helpers for Learn-tab generators (quizzes, study guides, mind
 * maps, podcast scripts). Mirrors the syllabus/flashcard pattern: 503 when the
 * key is unset, typed errors on API failure, and a structured-output helper.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let client;
function getClient(feature = 'This feature') {
  if (!env.anthropicApiKey) {
    throw new AppError(503, `${feature} is not configured. Set ANTHROPIC_API_KEY in the server environment.`);
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

/**
 * Run a single structured-output completion and return the parsed JSON.
 * @param {{ feature:string, system:string, user:string, schema:object, maxTokens?:number }} opts
 */
export async function runStructured({ feature, system, user, schema, maxTokens = 4096 }) {
  let message;
  try {
    message = await getClient(feature).messages.create({
      model: env.anthropicModel,
      max_tokens: maxTokens,
      output_config: { format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `${feature} failed: ${err?.message || 'unknown error'}`);
  }
  if (message.stop_reason === 'refusal') {
    throw AppError.badRequest('The model declined to process this material.');
  }
  try {
    return JSON.parse(message.content.find((b) => b.type === 'text')?.text ?? '{}');
  } catch {
    throw new AppError(502, `Could not parse the ${feature.toLowerCase()} result.`);
  }
}

/** Plain-text completion (no schema) — used for the podcast script body. */
export async function runText({ feature, system, user, maxTokens = 4096 }) {
  let message;
  try {
    message = await getClient(feature).messages.create({
      model: env.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    throw new AppError(502, `${feature} failed: ${err?.message || 'unknown error'}`);
  }
  if (message.stop_reason === 'refusal') throw AppError.badRequest('The model declined to process this material.');
  return message.content.find((b) => b.type === 'text')?.text ?? '';
}
