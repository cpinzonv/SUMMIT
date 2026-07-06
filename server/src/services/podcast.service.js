/**
 * Podcasts — Claude writes a podcast script from a class's material; if an
 * ElevenLabs key is configured we synthesize audio, otherwise the podcast is
 * stored with its transcript and audio is marked "pending" (audioUrl null).
 *
 * Audio storage: the synthesized MP3 is saved as a class_files row (category
 * 'audio', base64 — matching how this app already stores audio), and audioUrl
 * points at the existing file-download route. Rate limited to 5/user/day.
 */
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { gatherClassContext } from './learnSource.js';
import { runStructured } from './learnAi.js';

const DAILY_LIMIT = 5;

const scriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, script: { type: 'string' } },
        required: ['title', 'script'],
      },
    },
    conclusion: { type: 'string' },
    durationMinutes: { type: 'number' },
  },
  required: ['title', 'intro', 'segments', 'conclusion', 'durationMinutes'],
};

function toPublicPodcast(r) {
  return {
    id: r.id,
    classId: r.class_id,
    title: r.title,
    description: r.description ?? null,
    audioUrl: r.audio_url ?? null,
    audioPending: !r.audio_url,
    transcript: r.transcript_text ?? null,
    durationSeconds: r.duration_seconds ?? null,
    generatedFrom: r.generated_from ?? [],
    listenedAt: r.listened_at ?? null,
    completionPercent: r.completion_percent ?? 0,
    generatedAt: r.generated_at,
  };
}

/** Assemble the script blocks into one readable transcript string. */
function assembleTranscript({ intro, segments, conclusion }) {
  const parts = [intro, ...segments.map((s) => `${s.title}\n${s.script}`), conclusion];
  return parts.filter(Boolean).join('\n\n');
}

/** ElevenLabs caps characters per request, so a full 5–10 min script must be
 * split. We chunk on sentence boundaries (~2.5k chars) so nothing is cut. */
const TTS_CHUNK_CHARS = 2500;

export function chunkForTts(text, max = TTS_CHUNK_CHARS) {
  const sentences = String(text || '').trim().split(/(?<=[.!?])\s+/);
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const s of sentences) {
    if (s.length > max) {
      // A single sentence longer than the cap — hard-split it.
      flush();
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + s.length + 1 > max) flush();
    cur += (cur ? ' ' : '') + s;
  }
  flush();
  return chunks;
}

/** Synthesize one chunk. `previous_text`/`next_text` give ElevenLabs prosody
 * continuity across chunk boundaries so it doesn't sound stitched. */
async function ttsChunk(text, { previous, next }) {
  const { apiKey, voiceId, model } = env.elevenLabs;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        ...(previous ? { previous_text: previous.slice(-400) } : {}),
        ...(next ? { next_text: next.slice(0, 400) } : {}),
      }),
    },
  );
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 140);
    throw new AppError(502, `Text-to-speech failed (${res.status}). The script was saved.${detail ? ` (${detail})` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * ElevenLabs TTS seam. Returns a Buffer of the full MP3 (all chunks
 * concatenated), or null if no key is configured.
 */
async function synthesizeAudio(text) {
  if (!env.elevenLabs.apiKey) return null;
  const chunks = chunkForTts(text);
  if (chunks.length === 0) return null;
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    buffers.push(await ttsChunk(chunks[i], { previous: chunks[i - 1], next: chunks[i + 1] }));
  }
  return Buffer.concat(buffers);
}

export async function generatePodcast(userId, classId, { sourceType = null } = {}) {
  const cls = await getOwnedClass(userId, classId);

  // Rate limit: 5 generated podcasts per user per day.
  const { rows: cnt } = await query(
    `SELECT count(*)::int AS n FROM podcasts WHERE user_id = $1 AND generated_at >= date_trunc('day', now())`,
    [userId],
  );
  if (cnt[0].n >= DAILY_LIMIT) {
    throw new AppError(429, `Daily podcast limit reached (${DAILY_LIMIT}/day). Try again tomorrow.`);
  }

  const { text, sources } = await gatherClassContext(classId, sourceType);
  const system =
    `You are an expert podcast scriptwriter. Create an engaging ~5-10 minute podcast script from the ` +
    `"${cls.name}" material below: an introduction, 3-5 key concepts explained conversationally with ` +
    `real-world examples, and a conclusion with memory hooks. Use ONLY the material.\n\n"""\n${text}\n"""`;
  const script = await runStructured({
    feature: 'Podcast generation',
    system,
    user: 'Write the podcast script now.',
    schema: scriptSchema,
    maxTokens: 4096,
  });

  const transcript = assembleTranscript(script);
  const durationSeconds = Math.max(60, Math.round((script.durationMinutes || 6) * 60));

  // Optional audio synthesis (seam). Failures here keep the transcript.
  let audioUrl = null;
  try {
    const mp3 = await synthesizeAudio(transcript);
    if (mp3) {
      const { rows: f } = await query(
        `INSERT INTO class_files (class_id, user_id, filename, mime_type, size_bytes, data, category)
         VALUES ($1,$2,$3,'audio/mpeg',$4,$5,'audio') RETURNING id`,
        [classId, userId, `${script.title}.mp3`, mp3.length, mp3.toString('base64')],
      );
      audioUrl = `/api/files/${f.rows[0].id}/download`;
    }
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    // else: leave audioUrl null (pending) — the transcript still saves below.
  }

  const { rows } = await query(
    `INSERT INTO podcasts (class_id, user_id, title, description, audio_url, transcript_text, duration_seconds, generated_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [classId, userId, script.title, script.intro?.slice(0, 280) ?? null, audioUrl, transcript, durationSeconds, sources],
  );
  return toPublicPodcast(rows[0]);
}

export async function listClassPodcasts(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT * FROM podcasts WHERE class_id = $1 AND user_id = $2 ORDER BY generated_at DESC`,
    [classId, userId],
  );
  return rows.map(toPublicPodcast);
}

export async function recordListen(userId, podcastId, completionPercent) {
  const pct = Math.max(0, Math.min(100, Math.round(completionPercent)));
  const { rows } = await query(
    `UPDATE podcasts SET listened_at = now(), completion_percent = $1
      WHERE id = $2 AND user_id = $3 RETURNING id, completion_percent`,
    [pct, podcastId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Podcast not found');
  return { podcastId, completionPercent: rows[0].completion_percent };
}
