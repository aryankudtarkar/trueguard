import { describe, expect, it, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { EditService } from '../../src/review/editService';
import { DecisionStore } from '../../src/review/decisionStore';
import { ChangeStore } from '../../src/edits/store';
import { contentHash } from '../../src/util/hash';
import type { EditorBridge } from '../../src/edits/apply';
import type { ProposalContext } from '../../src/edits/proposal';

/**
 * The review pipeline, end to end without VS Code:
 *
 *   approval event → review → user decision → apply → verified result
 */

const BASE = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';

interface FakeFile {
  buffer: string;
  disk: string;
}

function fakeBridge(files: Record<string, FakeFile>): EditorBridge {
  return {
    async readText(path: string) { return files[path]?.buffer ?? ''; },
    async writeText(path: string, text: string) {
      const f = files[path];
      if (!f) { throw new Error(`no such file: ${path}`); }
      f.buffer = text;
      f.disk = text;
    },
    async snapshot(path: string) { return files[path]?.buffer ?? ''; },
    async restore(path: string, text: string) {
      const f = files[path];
      if (!f) { throw new Error(`no such file: ${path}`); }
      f.buffer = text;
      f.disk = text;
    },
    async readDisk(path: string) { return files[path]?.disk ?? ''; },
    async hash(path: string) { return contentHash(files[path]?.buffer ?? ''); },
  };
}

/** A session manager stub that records the approval decisions. */
function fakeSessions() {
  const emitter = new vscode.EventEmitter<{ thread_id: string; tool_calls: Array<{ id: string }> }>();
  const approvals: Array<{ threadId: string; toolCallId: string; status: string; reason?: string }> = [];
  const calls = new Map<string, { id: string; name: string; arguments: string }>();
  return {
    emitter,
    approvals,
    calls,
    stub: {
      onApprovalRequired: emitter.event,
      getToolCall: (id: string) => calls.get(id),
      sendApproval: async (threadId: string, toolCallId: string, status: 'allow' | 'deny', reason?: string) => {
        approvals.push({ threadId, toolCallId, status, reason });
      },
    },
  };
}

describe('edit service: the review pipeline', () => {
  let files: Record<string, FakeFile>;
  let changes: ChangeStore;
  let decisions: DecisionStore;
  let sessions: ReturnType<typeof fakeSessions>;
  let service: EditService;

  const path = '/ws/src/app.ts';

  beforeEach(() => {
    files = { [path]: { buffer: BASE, disk: BASE } };
    changes = new ChangeStore();
    decisions = new DecisionStore();
    sessions = fakeSessions();
    const ctx: ProposalContext = {
      async readFile(p: string) { return files[p]?.buffer; },
      async exists(p: string) { return p in files; },
    };
    service = new EditService(sessions.stub as never, fakeBridge(files), ctx, changes, decisions, 50);
  });

  const propose = (edits: Array<{ oldText: string; newText: string }>): void => {
    sessions.calls.set('call_1', {
      id: 'call_1',
      name: 'propose_edit',
      arguments: JSON.stringify({ changes: [{ path, kind: 'modify', edits }] }),
    });
  };

  it('builds a review with one hunk per edit, all accepted by default', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const pending = changes.pending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.files[0]?.hunks.length).toBe(1);
    expect(pending[0]?.files[0]?.accepted.size).toBe(1);
    expect(pending[0]?.state).toBe('reviewPending');
  });

  it('denies an invalid proposal instead of showing it to the user', async () => {
    propose([{ oldText: 'does not exist', newText: 'x' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    expect(changes.pending().length).toBe(0);
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(sessions.approvals[0]?.reason).toContain('does not appear');
  });

  it('denies a proposal whose arguments are not valid JSON', async () => {
    sessions.calls.set('call_1', { id: 'call_1', name: 'propose_edit', arguments: '{not json' });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(changes.pending().length).toBe(0);
  });

  it('applies every accepted hunk and verifies the result', async () => {
    propose([
      { oldText: 'export const a = 1;', newText: 'export const a = 11;' },
      { oldText: 'export const c = 3;', newText: 'export const c = 33;' },
    ]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    await service.applyChangeSet(changeSet.id);

    const result = await service.applyApproved();
    expect(result.status).toBe('applied');
    expect(result.files[0]?.verified).toBe(true);
    expect(files[path]?.disk).toContain('export const a = 11;');
    expect(files[path]?.disk).toContain('export const c = 33;');
    expect(changes.get(changeSet.id)?.state).toBe('verified');
    expect(changes.get(changeSet.id)?.note).toContain('Verified against disk');
  });

  it('applies only the hunks the user kept', async () => {
    propose([
      { oldText: 'export const a = 1;', newText: 'export const a = 11;' },
      { oldText: 'export const c = 3;', newText: 'export const c = 33;' },
    ]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    const hunks = changeSet.files[0]!.hunks;
    changes.setAccepted(changeSet.id, path, new Set([hunks[1]!.id]));

    await service.applyChangeSet(changeSet.id);
    const result = await service.applyApproved();
    expect(result.status).toBe('applied');
    expect(result.files[0]?.hunksAccepted).toBe(1);
    expect(result.files[0]?.hunksProposed).toBe(2);
    expect(files[path]?.disk).toContain('export const a = 1;');
    expect(files[path]?.disk).toContain('export const c = 33;');
  });

  it('writes nothing when the user rejects the change', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    await service.rejectChangeSet(changeSet.id, 'not this time');
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(sessions.approvals[0]?.reason).toBe('not this time');
    expect(changes.get(changeSet.id)?.state).toBe('rejected');
    expect(files[path]?.disk).toBe(BASE);
  });

  it('refuses to apply when the file changed after the proposal', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    // The user edits the file while the proposal waits.
    files[path]!.buffer = 'the user typed something\n';
    files[path]!.disk = files[path]!.buffer;
    await service.applyChangeSet(changeSet.id);
    const result = await service.applyApproved();
    expect(result.status).toBe('conflict');
    expect(result.files[0]?.verified).toBe(false);
    expect(changes.get(changeSet.id)?.state).toBe('conflict');
    expect(files[path]?.disk).toContain('the user typed something');
  });

  it('denies everything pending when the turn is stopped', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    await service.denyAllPending('The turn was stopped.');
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(changes.pending().length).toBe(0);
    expect(files[path]?.disk).toBe(BASE);
  });

  it('writes nothing when no decision was recorded', async () => {
    const result = await service.applyApproved();
    expect(result.status).toBe('rejected');
    expect(result.files.length).toBe(0);
    expect(files[path]?.disk).toBe(BASE);
  });

  it('ignores approvals for tools it does not handle', async () => {
    sessions.calls.set('call_1', { id: 'call_1', name: 'read_file', arguments: '{}' });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    expect(changes.pending().length).toBe(0);
    expect(sessions.approvals.length).toBe(0);
  });
  it('shows a command waiting for approval, with its risky patterns', async () => {
    sessions.calls.set('call_2', {
      id: 'call_2',
      name: 'run_command',
      arguments: JSON.stringify({ command: 'git push origin main' }),
    });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_2' }] } as never);
    expect(sessions.approvals.length).toBe(0); // nothing decided yet
    const pending = service.getPendingCommands();
    expect(pending.length).toBe(1);
    expect(pending[0]?.command).toBe('git push origin main');
    expect(pending[0]?.risky.join(' ')).toContain('pushes to a remote');
  });

  it('runs nothing until the user allows the command', async () => {
    sessions.calls.set('call_2', {
      id: 'call_2',
      name: 'run_command',
      arguments: JSON.stringify({ command: 'echo hi' }),
    });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_2' }] } as never);
    // The MCP handler asks for the approval: there is none yet.
    expect(service.takeCommandApproval()).toBeUndefined();
    await service.approveCommand('call_2');
    expect(sessions.approvals[0]?.status).toBe('allow');
    const approval = service.takeCommandApproval();
    expect(approval?.command).toBe('echo hi');
  });

  it('denies a command the user refused', async () => {
    sessions.calls.set('call_2', {
      id: 'call_2',
      name: 'run_command',
      arguments: JSON.stringify({ command: 'rm -rf /' }),
    });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_2' }] } as never);
    await service.denyCommand('call_2', 'too risky');
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(sessions.approvals[0]?.reason).toBe('too risky');
    expect(service.takeCommandApproval()).toBeUndefined();
    expect(service.getPendingCommands().length).toBe(0);
  });

  it('denies a command with invalid arguments', async () => {
    sessions.calls.set('call_2', { id: 'call_2', name: 'run_command', arguments: JSON.stringify({}) });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_2' }] } as never);
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(service.getPendingCommands().length).toBe(0);
  });

  it('denies pending commands when the turn is stopped', async () => {
    sessions.calls.set('call_2', {
      id: 'call_2',
      name: 'run_command',
      arguments: JSON.stringify({ command: 'echo hi' }),
    });
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_2' }] } as never);
    await service.denyAllPending('The turn was stopped.');
    expect(sessions.approvals[0]?.status).toBe('deny');
    expect(service.getPendingCommands().length).toBe(0);
  });
  it('records a checkpoint and can revert the change', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    await service.applyChangeSet(changeSet.id);
    const result = await service.applyApproved();
    expect(result.status).toBe('applied');
    expect(files[path]?.disk).toContain('export const a = 11;');

    // The change is revertible (FR-10).
    const checkpointId = service.checkpointFor(changeSet.id);
    expect(checkpointId).toBeDefined();
    const revert = await service.revertCheckpoint(checkpointId!);
    expect(revert.reverted).toBe(true);
    expect(files[path]?.disk).toBe(BASE);
  });

  it('reverts a diverged file when the user confirms', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    await service.applyChangeSet(changeSet.id);
    await service.applyApproved();
    const checkpointId = service.checkpointFor(changeSet.id)!;
    files[path]!.buffer = 'the user typed something\n';
    files[path]!.disk = files[path]!.buffer;
    // The mock answers the confirmation; the real API shows a modal.
    const mockWindow = vscode.window as unknown as { warningAnswer: string | undefined };
    mockWindow.warningAnswer = 'Revert anyway';
    try {
      const revert = await service.revertCheckpoint(checkpointId);
      expect(revert.reverted).toBe(true);
      expect(files[path]?.disk).toBe(BASE);
    } finally {
      mockWindow.warningAnswer = undefined;
    }
  });

  it('refuses to revert a file that changed since the change was applied', async () => {
    propose([{ oldText: 'export const a = 1;', newText: 'export const a = 11;' }]);
    await service.handleApprovalRequired({ thread_id: 'main', tool_calls: [{ id: 'call_1' }] } as never);
    const changeSet = changes.pending()[0]!;
    await service.applyChangeSet(changeSet.id);
    await service.applyApproved();
    const checkpointId = service.checkpointFor(changeSet.id)!;
    // The user edits the file afterwards.
    files[path]!.buffer = 'the user typed something\n';
    files[path]!.disk = files[path]!.buffer;
    const revert = await service.revertCheckpoint(checkpointId);
    // The confirmation was not accepted (no UI in the test): nothing is lost.
    expect(revert.reverted).toBe(false);
    expect(files[path]?.disk).toContain('the user typed something');
  });
});
