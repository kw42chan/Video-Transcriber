#!/usr/bin/env node
/**
 * Phase 0 Day 1 A/B runner.
 * For each clip in clips/:
 *   1) translate EN → HK 口語 (if yue.txt missing)
 *   2) run Canto-Gen / ElevenLabs / MiniMax when keys present
 *   3) write out/<clip-id>/<vendor>.mp3
 *   4) write out/scorecard.md with latency + char counts; blank human scores
 *
 * Usage: node scripts/run-ab.mjs
 *        node scripts/run-ab.mjs --skip-translate
 *        node scripts/run-ab.mjs --vendors canto-gen,elevenlabs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT,
  OUT_DIR,
  listClipIds,
  clipPaths,
  readText,
  writeText,
  charCount,
  ensureDir,
  hasEnv,
  resolveRefAudio,
  log,
  warn,
} from './lib/common.mjs';

const VENDORS = [
  {
    id: 'canto-gen',
    keys: ['CANTO_GEN_API_KEY', 'CANTOGEN_API_KEY'],
    script: 'scripts/tts-canto-gen.mjs',
    file: 'canto-gen.mp3',
  },
  {
    id: 'elevenlabs',
    keys: ['ELEVENLABS_API_KEY'],
    script: 'scripts/tts-elevenlabs.mjs',
    file: 'elevenlabs.mp3',
  },
  {
    id: 'minimax',
    keys: ['MINIMAX_API_KEY'],
    script: 'scripts/tts-minimax.mjs',
    file: 'minimax.mp3',
  },
];

function runNode(scriptRel, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT, scriptRel), ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on('close', (code) => {
      const latencyMs = Date.now() - t0;
      let meta = null;
      try {
        const match = stdout.match(/\[[\s\S]*\]\s*$/);
        if (match) meta = JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
      resolve({ code, stdout, stderr, latencyMs, meta });
    });
  });
}

function parseArgs(argv) {
  const skipTranslate = argv.includes('--skip-translate');
  const vIdx = argv.indexOf('--vendors');
  let only = null;
  if (vIdx >= 0 && argv[vIdx + 1]) {
    only = new Set(
      argv[vIdx + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return { skipTranslate, only };
}

function scorecardMd(rows, keyStatus) {
  const now = new Date().toLocaleString('en-HK', { timeZone: 'Asia/Shanghai' });
  const lines = [];
  lines.push('# Phase 0 Day 1 — TTS A/B Scorecard');
  lines.push('');
  lines.push(`Generated: ${now} (Asia/Shanghai)`);
  lines.push('');
  lines.push('## Key status (this run)');
  lines.push('');
  lines.push('| Vendor | Key present | Notes |');
  lines.push('| --- | --- | --- |');
  for (const k of keyStatus) {
    lines.push(`| ${k.id} | ${k.present ? 'yes' : 'NO'} | ${k.note} |`);
  }
  lines.push('');
  lines.push('## Dimensions');
  lines.push('');
  lines.push('| Dimension | What to judge |');
  lines.push('| --- | --- |');
  lines.push('| Voice similarity (1–5) | Clone matches the EN speaker’s timbre/identity |');
  lines.push('| 口語 naturalness (1–5) | Sounds like spoken HK Cantonese, not Mandarin / 書面語 |');
  lines.push('| Latency / cost | Wall-clock in table; cost = rough notes from vendor tier |');
  lines.push('| API ease (1–5) | Auth, clone upload, docs clarity, error messages |');
  lines.push('');
  lines.push('## PASS criteria (Day 1 brief)');
  lines.push('');
  lines.push('- [ ] At least **one** vendor produces listenably natural **HK 口語** (not Mandarin, not stiff 書面語).');
  lines.push('- [ ] Voice clone similarity ≥ **3/5** for the best vendor on ≥2/3 clips (same speaker refs).');
  lines.push('- [ ] No Mandarin-trap voice used (especially MiniMax `Chinese (Mandarin)_HK_Flight_Attendant`).');
  lines.push('- [ ] End-to-end offline harness: translate → 3× TTS → scorecard + audio under `out/`.');
  lines.push('- [ ] Latency recorded; no product UI / no lip sync required for Day 1 PASS.');
  lines.push('');
  lines.push('## Results (fill blank human columns)');
  lines.push('');
  lines.push(
    '| Clip | Vendor | Chars (yue) | Latency ms | Audio | Voice sim (1–5) | 口語 nat. (1–5) | API ease (1–5) | Mandarin leak? (Y/N) | Notes |'
  );
  lines.push('| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const audio = r.ok ? `\`${r.relAudio}\`` : '—';
    const lat = r.ok ? String(r.latencyMs) : `ERR`;
    const chars = r.chars ?? '—';
    const notes = (r.error || r.note || '').replace(/\|/g, '/').slice(0, 120);
    lines.push(
      `| ${r.clipId} | ${r.vendor} | ${chars} | ${lat} | ${audio} |  |  |  |  | ${notes} |`
    );
  }
  lines.push('');
  lines.push('## Listening checklist (per clip)');
  lines.push('');
  lines.push('1. Play EN source (if video present) then each vendor MP3 blind if possible.');
  lines.push('2. Mark Mandarin leak if you hear 普通話 tones / Northern particles / Flight-Attendant cadence.');
  lines.push('3. Prefer clone over gallery/system voices when scoring Voice similarity.');
  lines.push('');
  lines.push('## Winner (fill after listening)');
  lines.push('');
  lines.push('- Best overall: _______________');
  lines.push('- Best 口語: _______________');
  lines.push('- Best clone similarity: _______________');
  lines.push('- Drop / defer: _______________');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const { skipTranslate, only } = parseArgs(process.argv.slice(2));
  ensureDir(OUT_DIR);

  const clipIds = listClipIds();
  if (!clipIds.length) {
    warn(
      'No clips found. Add clips/<clip-id>/en.txt (and refs/default.wav ≥8–15s), then re-run.'
    );
    const stub = scorecardMd([], VENDORS.map((v) => {
      const present = hasEnv(v.keys[0], v.keys.slice(1));
      return {
        id: v.id,
        present,
        note: present
          ? 'key present; waiting for clips/'
          : `no key (${v.keys[0]}) — and no clips yet`,
      };
    }));
    writeText(path.join(OUT_DIR, 'scorecard.md'), stub);
    log(`Wrote empty template ${path.join(OUT_DIR, 'scorecard.md')}`);
    process.exit(0);
  }

  const keyStatus = VENDORS.map((v) => {
    const present = hasEnv(v.keys[0], v.keys.slice(1));
    return {
      id: v.id,
      present,
      note: present ? 'will run' : `skipped — set ${v.keys[0]}`,
    };
  });

  // Also note OpenRouter
  const orPresent = hasEnv('OPENROUTER_API_KEY');
  log(
    `OPENROUTER_API_KEY: ${orPresent ? 'present' : 'MISSING (translate will fail)'}`
  );
  log(`Clips: ${clipIds.join(', ')}`);

  if (!skipTranslate) {
    if (!orPresent) {
      warn('Skipping translate — OPENROUTER_API_KEY missing. Provide yue.txt manually.');
    } else {
      log('Translating missing yue.txt…');
      const tr = await runNode('scripts/translate-to-hk-kouyu.mjs', clipIds);
      if (tr.code !== 0) {
        warn('Translate script exited non-zero; continuing with any existing yue.txt');
      }
    }
  }

  const rows = [];
  for (const clipId of clipIds) {
    const { yue } = clipPaths(clipId);
    if (!fs.existsSync(yue)) {
      warn(`${clipId}: no yue.txt — skip all vendors`);
      for (const v of VENDORS) {
        if (only && !only.has(v.id)) continue;
        rows.push({
          clipId,
          vendor: v.id,
          ok: false,
          error: 'missing yue.txt',
          chars: null,
          latencyMs: null,
          relAudio: null,
        });
      }
      continue;
    }
    const text = readText(yue);
    const chars = charCount(text);
    const ref = resolveRefAudio(clipId);
    if (!ref) warn(`${clipId}: no refs/ audio — vendors will use gallery/system or fail clone`);

    for (const v of VENDORS) {
      if (only && !only.has(v.id)) continue;
      const present = hasEnv(v.keys[0], v.keys.slice(1));
      const outFile = path.join(OUT_DIR, clipId, v.file);
      const relAudio = path.relative(ROOT, outFile);
      if (!present) {
        rows.push({
          clipId,
          vendor: v.id,
          ok: false,
          error: `no key (${v.keys[0]})`,
          chars,
          latencyMs: null,
          relAudio: null,
          note: 'skipped',
        });
        continue;
      }
      log(`=== ${clipId} / ${v.id} ===`);
      const result = await runNode(v.script, [clipId, '--out', outFile]);
      const metaOne = Array.isArray(result.meta) ? result.meta[0] : null;
      const ok = result.code === 0 && fs.existsSync(outFile);
      rows.push({
        clipId,
        vendor: v.id,
        ok,
        chars: metaOne?.chars ?? chars,
        latencyMs: metaOne?.latencyMs ?? result.latencyMs,
        relAudio: ok ? relAudio : null,
        error: ok ? null : (result.stderr || result.stdout).slice(-400),
        note: metaOne
          ? `mode=${metaOne.mode || metaOne.voiceSource || ''} voice=${metaOne.voiceId || ''}`
          : '',
      });
    }
  }

  const md = scorecardMd(rows, keyStatus);
  const scorePath = path.join(OUT_DIR, 'scorecard.md');
  writeText(scorePath, md);

  // machine-readable sidecar
  writeText(
    path.join(OUT_DIR, 'scorecard.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), keyStatus, rows }, null, 2)
  );

  log(`Scorecard → ${scorePath}`);
  const okN = rows.filter((r) => r.ok).length;
  log(`Done: ${okN}/${rows.length} vendor×clip outputs OK`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
