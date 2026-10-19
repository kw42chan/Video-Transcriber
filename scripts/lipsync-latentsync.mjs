#!/usr/bin/env node
/**
 * Day 2c — LatentSync on Fal (fal-ai/latentsync). Thin wrapper: same flags/flow as lipsync-musetalk.mjs
 * (fal storage upload → queue → poll → download, estimate + spend guard before submit) with --model latentsync.
 * Price: US$0.20 flat ≤40 s, then US$0.005/s. Extra flags: --guidance-scale (1–2), --seed, --loop-mode, --max-usd.
 *   node scripts/lipsync-latentsync.mjs --video V.mp4 --audio A.wav --out O.mp4 [--max-usd 0.5] [--dry-run]
 */
if (!process.argv.includes('--model')) process.argv.push('--model', 'latentsync');
await import('./lipsync-musetalk.mjs');
