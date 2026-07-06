# Interactive podcasts — "join the conversation" (design / scoping)

Status: **proposed, not built.** This scopes the NotebookLM-style *interactive*
mode where a student can interrupt the two hosts, ask a question out loud, and
the hosts answer live. It builds on the shipped pre-rendered two-host podcast
(`server/src/services/podcast.service.js`), which stays as-is.

## What we already have vs. what this adds

| | Pre-rendered "deep dive" (shipped) | Interactive mode (this doc) |
|---|---|---|
| Generation | Claude writes the whole dialogue up front | Hosts respond turn-by-turn, live |
| Audio | ElevenLabs synth → one MP3, played back | Streaming TTS, sub-second, barge-in |
| User role | Listener | Participant — can interrupt & ask |
| Latency need | none (batch) | hard real-time (~<1.2s round trip) |
| Cost shape | one-off per podcast | per-minute of live session |
| Language | multi-language (multilingual v2) | **English-first** (STT + realtime quality) |

The gap is not "a bigger prompt" — it's a **real-time voice loop**. That's why
it's a separate effort.

## User experience

1. Student opens a generated podcast and taps **"Join the conversation."**
2. Audio starts playing (either the pre-rendered MP3 or a live-streamed intro).
3. A **"Raise hand / hold to talk"** button. On press we duck/pause the hosts,
   capture the mic, and show a live transcript of what the student is saying.
4. On release: student speech → text → the model answers *in character* as the
   two hosts (usually the expert, sometimes a quick back-and-forth) → streamed
   TTS in the host voices, resuming the episode afterward.
5. The exchange is appended to the transcript so it's saved with the episode.

## Architecture (real-time loop)

```
  mic ─▶ VAD/barge-in ─▶ STT (streaming) ─▶ dialogue LLM ─▶ TTS (streaming) ─▶ speaker
                              │                   ▲
                       live captions        episode context
                                            (script + notes + running transcript)
```

- **Transport:** WebSocket (or WebRTC for lowest latency) between browser and a
  new realtime service. Our current REST API is request/response and not a fit.
- **Turn state machine:** `playing → user_barge_in → listening → thinking →
  responding → playing`. Barge-in must instantly duck host audio.
- **Context:** reuse the generated `turns[]` + `gatherClassContext()` output as
  the system context so answers stay grounded in the class material (same
  "use ONLY the material" guardrail as generation).

## Tech options (pick one path)

**Option A — ElevenLabs Conversational AI (agents).** Highest voice quality,
same voices as our podcast, built-in turn-taking/barge-in. We wire an agent with
the class material as context. Least infra; most tied to one vendor. **Recommended
starting point** since we're already on ElevenLabs.

**Option B — OpenAI Realtime API (speech-to-speech).** One socket does STT +
reasoning + TTS with very low latency. Fewer moving parts, strong English. Voice
won't match our ElevenLabs hosts, and it adds an OpenAI dependency.

**Option C — Assemble it ourselves.** Browser `MediaRecorder` + a streaming STT
(Whisper streaming / Deepgram) → Claude (streaming) → ElevenLabs streaming TTS.
Most control and keeps Claude as the brain, but we own latency, VAD, and
barge-in — the most work.

Given the app is Claude-first for reasoning, a strong middle path is **C but with
Claude as the LLM** and ElevenLabs streaming for voice; fall back to A for a fast
first version.

## Latency budget (target < ~1.2s user-stops-talking → hosts-start)

- endpointing/VAD: ~150 ms · STT final: ~150–300 ms · LLM first token: ~300–500 ms ·
  TTS first audio: ~150–300 ms. Stream everything; start TTS on the first sentence.

## Cost & limits

- Billed **per minute of live audio** (STT + TTS + LLM tokens), not per artifact —
  materially pricier than a one-off podcast. Needs its own rate limit / session
  cap (e.g. minutes/day) distinct from the current `DAILY_LIMIT = 5`.
- Gate behind the existing `requirePremium('podcasts')` (or a new
  `interactivePodcasts` feature key) so it's controllable.

## Language

English-first: realtime STT + natural turn-taking degrade in other languages, and
the barge-in UX is tuned per-language. The pre-rendered podcast stays multilingual;
interactive ships English, others follow as quality allows.

## Phasing

1. **Spike** — one host, push-to-talk (no barge-in), Option A, English. Prove the
   round-trip + grounding in class material.
2. **Two hosts + barge-in** — interrupt handling, host-voice answers, live captions.
3. **Persistence + polish** — append Q&A to the transcript, session caps, analytics,
   reconnect handling.
4. **Fallbacks** — no-mic / unsupported-browser → text chat with the hosts.

## Open questions

- Vendor lock vs. Claude-as-brain (Option A vs C)?
- Session length cap & premium limits?
- Do interruptions edit the canonical transcript, or attach as a side thread?
- Mobile mic/autoplay constraints (iOS Safari) — needs a user-gesture to start audio.

## Reuse from the shipped feature

- `scriptSchema.turns[]` and the `HOSTS` personas/voices — same hosts, same voices.
- `gatherClassContext()` for grounding · `requirePremium` for gating ·
  `chunkForTts` / `ttsChunk` patterns for the streaming TTS adapter.
