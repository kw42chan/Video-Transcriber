import { spawn } from 'node:child_process';

const active = new Set();
function stop(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill('SIGKILL'));
      killer.on('close', (code) => { if (code !== 0) child.kill('SIGKILL'); });
      const fallback = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
      fallback.unref();
    } else {
      process.kill(-child.pid, 'SIGTERM');
      const force = setTimeout(() => {
        // The group leader may exit while descendants retain the output pipes.
        // Kill the group even after the leader exits so close can complete.
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }, 1000);
      force.unref();
    }
  } catch { /* Already exited. */ }
}
// A parent job timeout also terminates separately grouped stage descendants.
process.once('SIGTERM', () => {
  for (const child of active) stop(child);
  // Keep the orchestrator alive long enough for descendant force-kill timers.
  setTimeout(() => process.exit(143), 1100);
});

export function runProcess(command, args, options = {}) {
  const { timeout = 600000, maxOutput = 4 * 1024 * 1024, inherit = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...spawnOptions, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    let stdout = '', stderr = '', size = 0, failure;
    const fail = (message) => {
      if (failure) return;
      failure = new Error(message);
      stop(child);
    };
    const timer = setTimeout(() => fail('Processing stage timed out'), timeout);
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxOutput) { fail('Processing stage output limit exceeded'); return; }
        if (isError) stderr += chunk; else stdout += chunk;
        if (inherit) (isError ? process.stderr : process.stdout).write(chunk);
      });
    }
    child.once('error', (error) => { clearTimeout(timer); active.delete(child); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer); active.delete(child);
      // Do not persist provider output/credentials or internal file paths in job errors.
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Processing stage failed (${code})`));
      else resolve({ stdout, stderr });
    });
  });
}
