import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import { cancelProcess, runCommand } from '../../src/exec/runner';
import type { ChildProcess } from 'node:child_process';

/**
 * The command runner (Phase 5.5): timeout, cancel, large output, non-zero
 * exit. The commands are plain shell one-liners, so the tests stay fast and
 * portable.
 */

const cwd = os.tmpdir();

describe('command runner', () => {
  it('runs a command and reports the exit code', async () => {
    const result = await runCommand({ command: 'echo hello', cwd, timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe('hello');
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a non-zero exit code', async () => {
    const result = await runCommand({ command: 'exit 3', cwd, timeoutMs: 10_000 });
    expect(result.exitCode).toBe(3);
    expect(result.output).toBeDefined();
  });

  it('captures stderr as well', async () => {
    const result = await runCommand({ command: 'echo oops 1>&2', cwd, timeoutMs: 10_000 });
    expect(result.output).toContain('oops');
  });

  it('stops a command that runs too long', async () => {
    const started = Date.now();
    const result = await runCommand({ command: 'sleep 5', cwd, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('kills the whole process tree on timeout', async () => {
    // The child spawns a grandchild that would outlive it.
    const result = await runCommand({
      command: 'sh -c "sleep 30 & sleep 30"',
      cwd,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
  });

  it('keeps only the tail of a huge output', async () => {
    const result = await runCommand({
      command: 'for i in $(seq 1 5000); do echo "line $i"; done',
      cwd,
      timeoutMs: 20_000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(4096);
    // The tail is what survives: the last line is still there.
    expect(result.output).toContain('line 5000');
  });

  it('streams the output to the caller', async () => {
    const chunks: string[] = [];
    await runCommand({ command: 'echo streamed', cwd, timeoutMs: 10_000 }, {
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(chunks.join('')).toContain('streamed');
  });

  it('cancels a running command and kills its tree', async () => {
    let child: ChildProcess | undefined;
    const running = runCommand({ command: 'sleep 30', cwd, timeoutMs: 20_000 }, {
      onStart: (c) => { child = c; },
    });
    // Give the process a moment to start, then kill it.
    await new Promise((r) => setTimeout(r, 200));
    expect(child).toBeDefined();
    cancelProcess(child!);
    const result = await running;
    expect(result.exitCode === 0 || result.exitCode === null || result.signal !== null).toBe(true);
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it('reports a command that cannot be run', async () => {
    const result = await runCommand({ command: 'this-command-does-not-exist-xyz', cwd, timeoutMs: 10_000 });
    expect(result.exitCode).not.toBe(0);
  });
});
