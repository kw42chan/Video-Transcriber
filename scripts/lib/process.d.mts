export function runProcess(command: string, args: string[], options?: {
  timeout?: number; maxOutput?: number; inherit?: boolean;
  cwd?: string; env?: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string }>;
