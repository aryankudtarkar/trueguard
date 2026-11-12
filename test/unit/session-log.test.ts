import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionLog, redactValue } from '../../src/util/sessionLog';

describe('the session log', () => {
  it('writes one JSON line per event', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-log-'));
    const log = new SessionLog(dir);
    await log.append('session-1', 'turn.created', { turn_id: 't1' });
    await log.append('session-1', 'tool.response', { tool_call_id: 'c1' });
    const text = await readFile(log.fileFor('session-1'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as { type: string; session: string; data: unknown };
    expect(first.type).toBe('turn.created');
    expect(first.session).toBe('session-1');
    expect(first.data).toEqual({ turn_id: 't1' });
    await rm(dir, { recursive: true, force: true });
  });

  it('never writes a secret', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-log-'));
    const log = new SessionLog(dir);
    await log.append('session-2', 'turn.created', {
      authorization: 'Bearer sk-abcdef123456',
      api_key: 'sk-secret-value-1234',
      nested: { token: 'abc123456', safe: 'hello' },
    });
    const text = await readFile(log.fileFor('session-2'), 'utf8');
    expect(text).not.toContain('sk-abcdef123456');
    expect(text).not.toContain('sk-secret-value-1234');
    expect(text).not.toContain('abc123456');
    expect(text).toContain('[redacted]');
    expect(text).toContain('hello');
    await rm(dir, { recursive: true, force: true });
  });

  it('redacts a token inside free text', () => {
    expect(redactValue('Authorization: Bearer abcdefghijklmnop')).toContain('[redacted]');
    expect(redactValue('use sk-1234567890abc')).toContain('[redacted]');
    expect(redactValue('nothing to hide')).toBe('nothing to hide');
  });

  it('finds the most recent log file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'forgeguard-log-'));
    const log = new SessionLog(dir);
    await log.append('older', 'turn.created', {});
    await new Promise((r) => setTimeout(r, 10));
    await log.append('newer', 'turn.created', {});
    const latest = await log.latestFile();
    expect(latest).toBe(log.fileFor('newer'));
    expect((await readdir(dir)).length).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it('survives a directory that does not exist', async () => {
    const log = new SessionLog(path.join(os.tmpdir(), 'forgeguard-log-missing', 'nested'));
    await log.append('s', 'turn.created', {});
    expect(log.countFor('s')).toBe(1);
  });
});
