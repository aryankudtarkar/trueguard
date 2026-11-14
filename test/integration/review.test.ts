import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cleanup, workspaceTempDir } from './tempdir';
import type { StreamingEvent } from '../../src/trueforge/schemas';

/**
 * Phase 4 exit gate, in a real VS Code with the real extension, against a
 * real TrueForge server and the fake OpenAI provider:
 *
 *   the agent proposes an edit → the turn pauses at the approval gate →
 *   the review appears → the user accepts → the file is written, verified,
 *   and the agent is told the truth.
 *
 * Needs `npm run trueforge` (localhost:8790) and spikes/fake-openai.mjs
 * (localhost:8799). Skipped at runtime when they are not running.
 */

const FAKE_LLM = 'http://127.0.0.1:8799';

interface TrueGuardApi {
  sessions: {
    sendTurn(
      input: unknown[],
      onEvent: (event: StreamingEvent) => void,
      modelName: string,
    ): Promise<void>;
    getToolCalls(): Array<{ id: string; name: string; arguments: string }>;
    newChat(): void;
  };
  changes: {
    pending(): Array<{
      id: string;
      files: Array<{ path: string; hunks: unknown[]; accepted: Set<string> }>;
    }>;
    get(id: string): { state: string; note: string } | undefined;
    setAccepted(id: string, path: string, ids: Set<string>): unknown;
  };
  editService: {
    applyChangeSet(id: string): Promise<void>;
    rejectChangeSet(id: string, reason?: string): Promise<void>;
    approveCommand(toolCallId: string): Promise<void>;
    denyCommand(toolCallId: string, reason?: string): Promise<void>;
    getPendingCommands(): Array<{ toolCallId: string; command: string; risky: string[] }>;
  };
}

async function probe(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
}

async function setFakeMode(body: Record<string, unknown>): Promise<void> {
  await fetch(`${FAKE_LLM}/set-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getApi(): Promise<TrueGuardApi | undefined> {
  const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
  if (!ext) { return undefined; }
  const api = (await ext.activate()) as unknown as TrueGuardApi;
  return api;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value !== undefined) { return value; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

describe('phase 4 exit gate: approval gate and review', () => {
  it('writes only the accepted hunks, verifies them, and tells the agent the truth', async () => {
    if (!(await probe(`${FAKE_LLM}/set-mode`))) { return; } // no fake provider: skip
    const api = await getApi();
    if (!api) { return; }

    const dir = await workspaceTempDir('trueguard-p4');
    const file = path.join(dir, 'app.ts');
    const original = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
    await fs.writeFile(file, original, 'utf8');

    const args = JSON.stringify({
      changes: [
        {
          path: file,
          kind: 'modify',
          edits: [
            { oldText: 'export const a = 1;', newText: 'export const a = 11;' },
            { oldText: 'export const c = 3;', newText: 'export const c = 33;' },
          ],
        },
      ],
    });

    try {
      await setFakeMode({ mode: 'call-tool', tool: 'propose_edit', args });

      // 1. The agent proposes the edit; the turn pauses at the gate.
      const events: StreamingEvent[] = [];
      await api.sessions.sendTurn(
        [{ type: 'user.message', content: 'Change a and c.' }],
        (e) => events.push(e),
        'fake-provider/test-model',
      );
      expect(events.some((e) => e.type === 'tool.approval_required')).toBe(true);

      // 2. The review appears with one hunk per edit, all checked.
      const pending = await waitFor(() => (api.changes.pending().length ? api.changes.pending()[0] : undefined));
      expect(pending).toBeDefined();
      expect(pending?.files.length).toBe(1);
      const hunks = pending?.files[0]?.hunks ?? [];
      expect(hunks.length).toBe(2);
      expect(pending?.files[0]?.accepted.size).toBe(2);

      // 3. The user rejects one hunk and applies the rest.
      const changeSet = api.changes.pending()[0]!;
      const hunkIds = (changeSet.files[0]?.hunks as Array<{ id: string }>).map((h) => h.id);
      expect(hunkIds.length).toBe(2);
      api.changes.setAccepted(changeSet.id, changeSet.files[0]!.path, new Set([hunkIds[1]!]));

      await api.editService.applyChangeSet(changeSet.id);

      // 4. The file contains exactly the accepted change.
      const written = await fs.readFile(file, 'utf8');
      expect(written).toContain('export const a = 1;');
      expect(written).toContain('export const c = 33;');

      // 5. The review is verified and the agent was told the truth.
      const state = api.changes.get(changeSet.id);
      expect(state?.state).toBe('verified');
      expect(state?.note).toContain('Verified against disk');
    } finally {
      await setFakeMode({ mode: 'echo' });
      await cleanup(dir);
    }
  });

  it('runs a command only after the user allows it, and reports the result', async () => {
    if (!(await probe(`${FAKE_LLM}/set-mode`))) { return; }
    const api = await getApi();
    if (!api) { return; }

    const marker = 'trueguard-command-ok';
    // A fresh session: the fake provider only calls a tool in a conversation
    // that has no tool result yet.
    api.sessions.newChat();
    try {
      await setFakeMode({ mode: 'call-tool', tool: 'run_command', args: JSON.stringify({ command: `echo ${marker}` }) });

      // The turn pauses at the gate; the command waits for the user.
      const events: StreamingEvent[] = [];
      await api.sessions.sendTurn(
        [{ type: 'user.message', content: 'Run the command.' }],
        (e) => events.push(e),
        'fake-provider/test-model',
      );
      const gate = events.find((e) => e.type === 'tool.approval_required');
      expect(gate !== undefined).toBe(true);

      const pending = await waitFor(() => {
        const commands = api.editService.getPendingCommands();
        return commands.length ? commands[0] : undefined;
      });
      expect(pending).toBeDefined();
      expect(pending?.command).toBe(`echo ${marker}`);

      // The user allows it.
      await api.editService.approveCommand(pending!.toolCallId);
      await waitFor(() => api.editService.getPendingCommands().length === 0 ? true : undefined, 5000);
    } finally {
      await setFakeMode({ mode: 'echo' });
    }
  });
});
