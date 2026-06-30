/**
 * Speech-to-text for lecture recordings.
 *
 * Anthropic/Claude has no audio transcription API, so this is a pluggable seam:
 * by default it's unconfigured, and a recording simply stores the audio with an
 * empty transcript the student fills in (paste/edit). To enable real auto-STT,
 * wire a provider (e.g. an external Whisper/Deepgram service) inside
 * `transcribeAudio` and have `isTranscriptionConfigured` reflect its env.
 */
import { AppError } from '../utils/AppError.js';

export function isTranscriptionConfigured() {
  return false;
}

/* eslint-disable no-unused-vars */
export async function transcribeAudio(buffer, mimetype) {
  throw new AppError(
    503,
    'Automatic transcription is not configured. The recording was saved — paste or upload the transcript text.',
    { code: 'transcription_unavailable' },
  );
}
