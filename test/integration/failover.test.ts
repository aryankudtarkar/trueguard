import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import type { StreamingEvent } from '../../src/trueforge/schemas';

/**
 * Phase 6 exit gate, live against a real TrueForge server:
 *
 *   the primary model is rate-limited → the turn continues on the fallback
 *   model → the user sees one calm notice → the answer arrives.
 *
 * The fake provider fails any model whose name contains "fail429", so the
 * failover is deterministic without a real rate limit.
 *
 * Needs `npm run trueforge` (localhost:8790) and spikes/fake-openai.mjs
 * (localhost:8799).
 */

const FAKE_LLM = 'http://127.0.0.1:8799';

interface TrueGuardApi {
  sessions: {
    sendTurn(
      input: unknown[],
      onEvent: (event: StreamingEvent) => void,
      modelName: string,
    ): Promise<void>;
    onFailover(listener: (notice: { notice: string; model: string; from?: string }) => void): { dispose(): void };
    newChat(): void;
  };
}

async function probe(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
}

describe('phase 6 exit gate: failover', () => {
  it('continues the turn on the fallback model and tells the user once', async () => {
    if (!(await probe(`${FAKE_LLM}/set-mode`))) { return; } // no fake provider: skip
    const ext = vscode.extensions.getExtension('trueguard-dev.trueguard');
    if (!ext) { return; }
    const api = (await ext.activate()) as unknown as TrueGuardApi;

    const config = vscode.workspace.getConfiguration('trueguard');
    const previous = config.get<Array<{ id: string; label: string; ref: string }>>('models', []);
    await config.update(
      'models',
      [
        { id: 'primary', label: 'Model A', ref: 'fake-provider/fail429-model' },
        { id: 'fallback', label: 'Model B', ref: 'fake-provider/test-model' },
      ],
      vscode.ConfigurationTarget.Global,
    );
    api.sessions.newChat();

    try {
      const notices: Array<{ notice: string; model: string }> = [];
      const subscription = api.sessions.onFailover((notice) => notices.push(notice));
      const events: StreamingEvent[] = [];
      try {
        await api.sessions.sendTurn(
          [{ type: 'user.message', content: 'Say hello.' }],
          (e) => events.push(e),
          'fake-provider/fail429-model',
        );
      } finally {
        subscription.dispose();
      }

      // The turn continued and finished on the fallback model: the LAST
      // turn.done is the one that matters (the first one was the failure).
      const done = [...events].reverse().find((e) => e.type === 'turn.done');
      expect(done).toBeDefined();
      const state = (done as { state?: { status?: string; message?: string } }).state;
      expect(state?.status).toBe('done');

      // Exactly one calm notice, naming the fallback.
      expect(notices.length).toBe(1);
      expect(notices[0]?.model).toBe('Model B');
      expect(notices[0]?.notice).toContain('Model B');
    } finally {
      await config.update('models', previous, vscode.ConfigurationTarget.Global);
    }
  });
});
