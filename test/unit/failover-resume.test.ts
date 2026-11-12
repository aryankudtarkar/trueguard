import { describe, expect, it, beforeEach } from 'vitest';
import { FailoverManager, type ModelProfile } from '../../src/failover/manager';
import { ToolCallGuard } from '../../src/util/idempotency';
import type { ToolResult } from '../../src/mcp/tools';

/**
 * The two guarantees of G3 that the manager alone cannot show:
 *  - a failed turn continues on the next model (resume strategy),
 *  - a tool that already ran does NOT run again.
 */

const MODELS: ModelProfile[] = [
  { id: 'a', label: 'Model A', ref: 'fake-provider/test-model' },
  { id: 'b', label: 'Model B', ref: 'fake-provider/backup-model' },
];

describe('failover resume', () => {
  let patched: string[];
  let sent: number;

  beforeEach(() => {
    patched = [];
    sent = 0;
  });

  /** A stand-in for the turn loop: fail once, then succeed on the fallback. */
  async function runTurn(
    manager: FailoverManager,
    send: (model: string) => Promise<{ error?: string }>,
  ): Promise<{ attempts: string[]; notices: string[] }> {
    const attempts: string[] = [];
    const notices: string[] = [];
    let model = manager.active?.ref ?? '';
    for (;;) {
      attempts.push(model);
      sent++;
      const result = await send(model);
      if (!result.error) {
        manager.noteSuccess(model);
        return { attempts, notices };
      }
      const decision = await manager.handleFailure({ message: result.error });
      if (decision.action === 'giveup' || !decision.model) {
        return { attempts, notices };
      }
      notices.push(decision.notice ?? '');
      patched.push(decision.model.ref);
      model = decision.model.ref;
    }
  }

  it('continues the turn on the next model after a 429', async () => {
    const manager = new FailoverManager(MODELS, { now: () => 1_000, sleep: async () => undefined });
    const result = await runTurn(manager, async (model) => {
      if (model === MODELS[0]!.ref) { return { error: '[Model Error] 429 rate limit exceeded' }; }
      return {};
    });
    expect(result.attempts).toEqual([MODELS[0]!.ref, MODELS[1]!.ref]);
    expect(patched).toEqual([MODELS[1]!.ref]);
    expect(result.notices[0]).toContain('Model B');
  });

  it('gives up when every model failed', async () => {
    const manager = new FailoverManager(MODELS, { now: () => 1_000, sleep: async () => undefined });
    const result = await runTurn(manager, async () => ({ error: '503 service unavailable' }));
    expect(result.attempts.length).toBe(2);
    expect(result.notices.length).toBe(1);
  });

  it('does not fail over a request-fatal error', async () => {
    const manager = new FailoverManager(MODELS, { now: () => 1_000, sleep: async () => undefined });
    const result = await runTurn(manager, async () => ({ error: '400 bad request: context length exceeded' }));
    expect(result.attempts.length).toBe(1);
    expect(sent).toBe(1);
  });

  it('does not run a tool twice when the model asks again', async () => {
    const guard = new ToolCallGuard();
    let runs = 0;
    const tool = async (): Promise<ToolResult> => {
      runs++;
      return { content: [{ type: 'text', text: `run ${runs}` }] };
    };
    const key = ToolCallGuard.key('propose_edit', { changes: [{ path: 'a.ts' }] });
    const first = await guard.run(key, tool);
    const second = await guard.run(key, tool);
    expect(runs).toBe(1);
    expect(second.content[0]?.text).toBe(first.content[0]?.text);
  });

  it('does not confuse two different calls', async () => {
    const guard = new ToolCallGuard();
    let runs = 0;
    const tool = async (): Promise<ToolResult> => {
      runs++;
      return { content: [{ type: 'text', text: `run ${runs}` }] };
    };
    await guard.run(ToolCallGuard.key('read_file', { path: 'a.ts' }), tool);
    await guard.run(ToolCallGuard.key('read_file', { path: 'b.ts' }), tool);
    expect(runs).toBe(2);
  });

  it('forgets the calls of the previous turn', async () => {
    const guard = new ToolCallGuard();
    let runs = 0;
    const tool = async (): Promise<ToolResult> => {
      runs++;
      return { content: [{ type: 'text', text: `run ${runs}` }] };
    };
    const key = ToolCallGuard.key('read_file', { path: 'a.ts' });
    await guard.run(key, tool);
    guard.reset();
    await guard.run(key, tool);
    expect(runs).toBe(2);
  });
});
