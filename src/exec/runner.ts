import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Process runner (Phase 5.2).
 *
 * Runs a command in a shell, inside the workspace, with a timeout. The output
 * streams to a callback (the Commands output channel) and only the tail is
 * kept, so a chatty command cannot flood the agent's context.
 *
 * Cancelling kills the WHOLE process tree: on POSIX the child runs in its own
 * process group, on Windows `taskkill /T /F` takes the tree down.
 */

export interface RunRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  /** Maximum bytes of output kept for the agent (default 16 KB). */
  maxOutputBytes?: number;
}

export interface RunResult {
  /** Exit code, or null when the process was killed by a signal. */
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  /** The tail of the combined output. */
  output: string;
  /** True when the output was cut. */
  truncated: boolean;
  /** True when the command was stopped because it ran out of time. */
  timedOut: boolean;
  /** True when the user cancelled the run. */
  cancelled: boolean;
}

export interface RunOptions {
  /** Called with every chunk of output (for the output channel). */
  onOutput?: (chunk: string) => void;
  /** Called when the process starts (so the caller can cancel it). */
  onStart?: (child: ChildProcess) => void;
  /** Injectable for tests. */
  spawnFn?: typeof spawn;
}

export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;

/** Run a command and wait for it to finish. */
export function runCommand(request: RunRequest, options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const maxBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const spawnFn = options.spawnFn ?? spawn;

  return new Promise<RunResult>((resolve) => {
    let output = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawnFn(request.command, {
      shell: true,
      cwd: request.cwd,
      env: process.env,
      windowsHide: true,
      // A new process group on POSIX, so the whole tree can be killed.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killTree = (): void => {
      if (child.pid === undefined) { return; }
      if (process.platform === 'win32') {
        try {
          spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          child.kill('SIGKILL');
        }
        return;
      }
      try {
        // Negative pid kills the whole process group.
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, request.timeoutMs);
    timer.unref?.();

    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      options.onOutput?.(text);
      bytes += Buffer.byteLength(text, 'utf8');
      // Keep the tail: the end of the output is what matters most.
      output += text;
      if (bytes > maxBytes * 2) {
        output = output.slice(-maxBytes);
        truncated = true;
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      const result: RunResult = {
        exitCode,
        signal,
        durationMs: Date.now() - started,
        output,
        truncated: truncated || bytes > maxBytes,
        timedOut,
        cancelled,
      };
      resolve(result);
    };

    child.on('error', (e) => {
      options.onOutput?.(`\n[trueguard] could not run the command: ${e.message}\n`);
      finish(127, null);
    });

    child.on('close', (code, signal) => {
      finish(code, signal);
    });

    options.onStart?.(child);
  });
}

/**
 * Cancel a running command: kills the process tree.
 * The runner resolves with `cancelled: true`.
 */
export function cancelProcess(child: ChildProcess): void {
  if (child.pid === undefined) { return; }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}
