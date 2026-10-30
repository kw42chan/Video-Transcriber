#!/usr/bin/env node
/**
 * SaaS worker glue: single video → ASR → segment translate → Canto-Gen TTS → align → lip sync.
 * Does not replace CLI clip workflows; invoked with an isolated work directory.
 *
 * Usage:
 *   node scripts/run-saas-pipeline.mjs --work-dir /tmp/job-abc [--ref /path/to/ref.wav] [--skip-lipsync]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, env, log, warn, ensureDir, hasEnv } from './lib/common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      if (opts.inherit) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (opts.inherit) process.stderr.write(d);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function parseArgs(argv) {
  const workIdx = argv.indexOf('--work-dir');
  const refIdx = argv.indexOf('--ref');
  return {
    workDir: workIdx >= 0 ? argv[workIdx + 1] : null,
    refPath: refIdx >= 0 ? argv[refIdx + 1] : null,
    skipLipsync: argv.includes('--skip-lipsync'),
  };
}

async function probeDuration(videoPath) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    videoPath,
  ]);
  return Number(stdout.trim());
}

async function main() {
  const { workDir, refPath, skipLipsync } = parseArgs(process.argv.slice(2));
  if (!workDir) {
    console.error('Usage: node scripts/run-saas-pipeline.mjs --work-dir DIR [--ref refs.wav] [--skip-lipsync]');
    process.exit(2);
  }

  const videoPath = path.join(workDir, 'video.mp4');
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Missing ${videoPath}`);
  }

  ensureDir(workDir);
  const audio16 = path.join(workDir, 'audio_16k.wav');
  log('Extracting 16 kHz mono audio…');
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    videoPath,
    '-ac',
    '1',
    '-ar',
    '16000',
    audio16,
  ]);

  const asrPy = path.join(ROOT, 'scripts/asr_whisper.py');
  const model = env('WHISPER_MODEL', 'base');
  if (fs.existsSync(asrPy)) {
    log(`ASR (faster-whisper ${model})…`);
    const py = env('PYTHON', 'python3');
    await run(py, [asrPy, audio16, workDir, model], { inherit: true });
  } else if (!fs.existsSync(path.join(workDir, 'en.txt'))) {
    throw new Error('ASR script missing and no en.txt in work dir');
  }

  if (!fs.existsSync(path.join(workDir, 'en_segments.json'))) {
    throw new Error('ASR did not produce en_segments.json');
  }

  log('Segment translate (HK 口語)…');
  await run(process.execPath, [path.join(ROOT, 'scripts/translate-segments.mjs'), workDir], {
    inherit: true,
  });

  const ref =
    refPath ||
    env('SAAS_DEFAULT_REF') ||
    path.join(ROOT, 'refs/default.wav');
  if (!fs.existsSync(ref)) {
    warn('No reference audio — Canto-Gen will use gallery voice');
  }

  log('Per-segment Canto-Gen TTS…');
  await run(
    process.execPath,
    [
      path.join(ROOT, 'scripts/tts-segments.mjs'),
      workDir,
      ref,
      '--vendors',
      'canto-gen',
    ],
    { inherit: true }
  );

  log('Align + mux audio…');
  const py = env('PYTHON', 'python3');
  await run(py, [
    path.join(ROOT, 'scripts/align_mux.py'),
    workDir,
    videoPath,
    'canto-gen',
  ]);

  const clipBase = path.basename(workDir);
  const muxed = path.join(workDir, `${clipBase}_yue_canto-gen.mp4`);
  const dubbedAudio = path.join(workDir, 'canto-gen_yue.wav');
  const outputs = {
    muxedVideo: muxed,
    dubbedAudio,
    yueSegments: path.join(workDir, 'yue_segments.json'),
    enSegments: path.join(workDir, 'en_segments.json'),
  };

  let lipsyncOut = null;
  if (!skipLipsync) {
    const syncKey = hasEnv('SYNCLABS_API_KEY', ['SYNC_API_KEY']);
    const falKey = hasEnv('FAL_KEY');
    if (syncKey) {
      lipsyncOut = path.join(workDir, 'final_lipsync.mp4');
      log('Sync Labs lip sync…');
      await run(
        process.execPath,
        [
          path.join(ROOT, 'scripts/lipsync-synclabs.mjs'),
          '--video',
          muxed,
          '--audio',
          dubbedAudio,
          '--out',
          lipsyncOut,
        ],
        { inherit: true }
      );
      outputs.finalVideo = lipsyncOut;
    } else if (falKey) {
      lipsyncOut = path.join(workDir, 'final_lipsync.mp4');
      log('Fal MuseTalk lip sync (fallback)…');
      await run(
        process.execPath,
        [
          path.join(ROOT, 'scripts/lipsync-musetalk.mjs'),
          '--video',
          muxed,
          '--audio',
          dubbedAudio,
          '--out',
          lipsyncOut,
        ],
        { inherit: true }
      );
      outputs.finalVideo = lipsyncOut;
    } else {
      warn('No SYNCLABS_API_KEY or FAL_KEY — skipping lip sync');
      outputs.finalVideo = muxed;
    }
  } else {
    outputs.finalVideo = muxed;
  }

  const duration = await probeDuration(videoPath);
  const manifest = {
    ok: true,
    durationSeconds: duration,
    outputs,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(workDir, 'pipeline_result.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
