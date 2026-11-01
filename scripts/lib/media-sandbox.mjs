import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './process.mjs';
import { execFileSync } from 'node:child_process';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function mediaEnvironment(source = process.env) {
  const result = { PATH: source.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp',
    LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1', HF_HOME: '/opt/whisper-models' };
  if (source.SystemRoot) result.SystemRoot = source.SystemRoot;
  return result;
}

export function mediaCommand(command, args, workDir) {
  if (process.env.SAAS_MODE !== '1') return { command, args };
  if (process.platform !== 'linux') throw new Error('SaaS media processing requires the Linux sandbox');
  if (process.getuid() === 0) throw new Error('SaaS media processing must run as a non-root user');
  const mounts = ['/usr', '/bin', '/lib', '/lib64', '/etc/ld.so.cache', '/opt/whisper-models']
    .filter((p) => fs.existsSync(p)).flatMap((p) => ['--ro-bind', p, p]);
  return { command: 'bwrap', args: [
    '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--uid', String(process.getuid()), '--gid', String(process.getgid()),
    ...mounts, '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--ro-bind', scripts, scripts, '--bind', fs.realpathSync(workDir), fs.realpathSync(workDir),
    '--chdir', workDir, '--', command, ...args,
  ] };
}

export function runMedia(command, args, workDir, options = {}) {
  const invocation = mediaCommand(command, args, workDir);
  return runProcess(invocation.command, invocation.args, { ...options, cwd: workDir,
    env: mediaEnvironment(), timeout: options.timeout ?? 600000 });
}

export function mediaExecSync(command, args, workDir) {
  const invocation = mediaCommand(command, args, workDir);
  return execFileSync(invocation.command, invocation.args, { cwd: workDir,
    env: mediaEnvironment(), encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024, windowsHide: true });
}
