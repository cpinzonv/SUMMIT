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

/**
 * Two-host "deep dive" (NotebookLM-style). host_a asks the questions a student
 * would; host_b is the expert who explains. Each host has a name (for the
 * transcript) and its own ElevenLabs voice (see voiceFor / env).
 */
const HOSTS = {
  host_a: { name: 'Maya', voiceKey: 'voiceIdA' }, // curious co-host
  host_b: { name: 'Sam', voiceKey: 'voiceIdB' }, //  expert
};

const scriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string' }, // one-line blurb for the card
    turns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          speaker: { type: 'string', enum: ['host_a', 'host_b'] },
          text: { type: 'string' },
        },
        required: ['speaker', 'text'],
      },
    },
    durationMinutes: { type: 'number' },
  },
  required: ['title', 'description', 'turns', 'durationMinutes'],
};

const nameFor = (speaker) => HOSTS[speaker]?.name ?? 'Host';

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

/** Render the dialogue turns into a readable "Name: line" transcript. */
function assembleTranscript(turns) {
  return (turns || [])
    .filter((t) => t?.text?.trim())
    .map((t) => `${nameFor(t.speaker)}: ${t.text.trim()}`)
    .join('\n\n');
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

/** Resolve a host's ElevenLabs voice id, falling back to the primary voice. */
function voiceFor(speaker) {
  const key = HOSTS[speaker]?.voiceKey;
  return env.elevenLabs[key] || env.elevenLabs.voiceIdA;
}

/** Synthesize one chunk in a given voice. `previous_text`/`next_text` give
 * ElevenLabs prosody continuity across boundaries so it doesn't sound stitched. */
async function ttsChunk(text, { voiceId, previous, next }) {
  const { apiKey, model } = env.elevenLabs;
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
 * Synthesize the two-host dialogue: each turn is spoken in its host's voice
 * (long turns are still sentence-chunked), then all the MP3 bytes are
 * concatenated in order. Returns a Buffer, or null if no key is configured.
 */
async function synthesizeDialogue(turns) {
  if (!env.elevenLabs.apiKey) return null;
  const clean = (turns || []).filter((t) => t?.text?.trim());
  if (clean.length === 0) return null;
  const buffers = [];
  for (let i = 0; i < clean.length; i++) {
    const voiceId = voiceFor(clean[i].speaker);
    const chunks = chunkForTts(clean[i].text);
    for (let j = 0; j < chunks.length; j++) {
      buffers.push(
        await ttsChunk(chunks[j], {
          voiceId,
          // continuity: within a turn use adjacent chunks; at turn edges, the neighbouring turn.
          previous: chunks[j - 1] ?? clean[i - 1]?.text,
          next: chunks[j + 1] ?? clean[i + 1]?.text,
        }),
      );
    }
  }
  return buffers.length ? Buffer.concat(buffers) : null;
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
    `You are the writer for a two-host "deep dive" study podcast about "${cls.name}" — the warm, ` +
    `conversational NotebookLM style. Write a natural back-and-forth between two hosts:\n` +
    `- ${HOSTS.host_a.name} (host_a): a curious, upbeat co-host who asks the questions a student would, ` +
    `reacts, and keeps things moving.\n` +
    `- ${HOSTS.host_b.name} (host_b): the knowledgeable one who explains clearly with analogies and ` +
    `real-world examples.\n\n` +
    `Aim for ~5-10 minutes (roughly 14-26 short turns). Open with a quick hook, alternate speakers ` +
    `naturally (not rigidly), include the odd bit of banter, and close with the key takeaways. Spell out ` +
    `numbers/symbols as they'd be spoken. Use ONLY the material below — do not invent facts.\n\n` +
    `"""\n${text}\n"""`;
  const script = await runStructured({
    feature: 'Podcast generation',
    system,
    user: 'Write the two-host podcast dialogue now.',
    schema: scriptSchema,
    maxTokens: 5000,
  });

  const transcript = assembleTranscript(script.turns);
  const durationSeconds = Math.max(60, Math.round((script.durationMinutes || 6) * 60));

  // Optional audio synthesis (seam). Failures here keep the transcript.
  let audioUrl = null;
  try {
    const mp3 = await synthesizeDialogue(script.turns);
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
    [classId, userId, script.title, script.description?.slice(0, 280) ?? null, audioUrl, transcript, durationSeconds, sources],
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
