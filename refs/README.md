# refs/

Voice-clone reference audio for the speaker you want to match.

- Prefer **clean, single-speaker** speech, **≥8–15 s** (Canto-Gen minimum 8 s; MiniMax clone minimum 10 s).
- Formats: wav / mp3 / m4a / webm / ogg (vendor-dependent; wav or mp3 is safest).
- Naming:
  - `refs/default.wav` (or `.mp3`) — used for every clip when no per-clip ref exists
  - `refs/<clip-id>.wav` — optional per-clip override

Consent: only clone your own voice or a voice you have explicit permission to clone.
