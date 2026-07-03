/**
 * Speech-to-text for lecture recordings.
 *
 * Anthropic/Claude has no audio transcription API, so transcription runs through
 * OpenAI Whisper. This stays a pluggable seam: when OPENAI_API_KEY is unset the
 * feature is "unconfigured" and a recording simply stores the audio with an empty
 * transcript the student fills in (paste/edit) — callers treat the 503 as a
 * graceful no-op. When the key is present, transcribeAudio() calls Whisper.
 *
 * Whisper limits: single file ≤ 25 MB; common audio/video containers (mp3, mp4,
 * m4a, wav, webm, ...). Larger files must be chunked upstream (not done here).
 */
import OpenAI, { toFile } from 'openai';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const MAX_BYTES = 25 * 1024 * 1024; // Whisper hard limit

let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}

/** True when a Whisper key is configured (drives the "auto-transcription on" UI). */
export function isTranscriptionConfigured() {
  return Boolean(env.openaiApiKey);
}

/**
 * Transcribe an audio buffer to text via Whisper.
 * @param {Buffer} buffer   raw audio bytes
 * @param {string} mimetype e.g. 'audio/webm' (used only to name the upload)
 * @param {string} [filename='audio'] original filename for the multipart part
 * @returns {Promise<string>} the transcript text
 * @throws {AppError} 503 when unconfigured, 413 when too large, 502/503 on API failure
 */
export async function transcribeAudio(buffer, mimetype, filename = 'audio') {
  if (!isTranscriptionConfigured()) {
    throw new AppError(
      503,
      'Automatic transcription is not configured. The recording was saved — paste or upload the transcript text.',
      { code: 'transcription_unavailable' },
    );
  }
  if (!buffer?.length) {
    throw AppError.badRequest('There is no audio to transcribe.');
  }
  if (buffer.length > MAX_BYTES) {
    throw new AppError(
      413,
      `This audio is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — over Whisper's 25 MB limit. Split the recording into shorter parts.`,
      { code: 'audio_too_large' },
    );
  }

  let result;
  try {
    const file = await toFile(buffer, filename || 'audio', mimetype ? { type: mimetype } : undefined);
    result = await getClient().audio.transcriptions.create({
      file,
      model: env.openaiWhisperModel,
      response_format: 'text',
    });
  } catch (err) {
    if (err?.status === 401) {
      throw new AppError(503, 'Transcription failed: the OpenAI API key is invalid. Check OPENAI_API_KEY.');
    }
    if (err?.status === 429) {
      throw new AppError(429, 'Transcription is rate-limited right now. Try again in a minute.');
    }
    throw new AppError(502, `Transcription failed: ${err?.message || 'unknown error'}`);
  }

  // response_format:'text' → the SDK returns a plain string.
  const text = (typeof result === 'string' ? result : result?.text || '').trim();
  if (!text) throw new AppError(502, 'Transcription returned no text.');
  return text;
}
