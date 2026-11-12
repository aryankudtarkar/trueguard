import { describe, expect, it } from 'vitest';
import { ChangeStore, canTransition, type ChangeSet, type FileChange } from '../../src/edits/store';
import { computeHunks } from '../../src/edits/hunks';

const BASE = 'a\nb\nc\n';

function fileChange(path = 'src/a.ts', base = BASE): FileChange {
  return {
    path,
    baseHash: 'hash',
    hunks: computeHunks(base, 'a\nB\nc\n'),
    accepted: new Set(),
  };
}

function storeWithProposal(): { store: ChangeStore; changeSet: ChangeSet } {
  const store = new ChangeStore();
  const changeSet = store.create([fileChange()]);
  return { store, changeSet };
}

describe('change store', () => {
  it('starts in the proposed state', () => {
    const { changeSet } = storeWithProposal();
    expect(changeSet.state).toBe('proposed');
  });

  it('gives the same id to the same proposal', () => {
    const store = new ChangeStore();
    const a = store.create([fileChange()], 'call_1');
    const b = store.create([fileChange()], 'call_1');
    expect(a.id).toBe(b.id);
  });

  it('walks the happy path', () => {
    const { store, changeSet } = storeWithProposal();
    store.transition(changeSet.id, 'reviewPending');
    store.transition(changeSet.id, 'accepted');
    store.transition(changeSet.id, 'applying');
    store.transition(changeSet.id, 'verified');
    expect(store.get(changeSet.id)?.state).toBe('verified');
  });

  it('refuses illegal transitions', () => {
    const { store, changeSet } = storeWithProposal();
    expect(() => store.transition(changeSet.id, 'verified')).toThrow(/illegal change transition/);
    store.transition(changeSet.id, 'reviewPending');
    store.transition(changeSet.id, 'rejected');
    expect(() => store.transition(changeSet.id, 'applying')).toThrow(/illegal change transition/);
  });

  it('allows the conflict path and a re-review', () => {
    const { store, changeSet } = storeWithProposal();
    store.transition(changeSet.id, 'reviewPending');
    store.transition(changeSet.id, 'conflict');
    store.transition(changeSet.id, 'reviewPending');
    expect(store.get(changeSet.id)?.state).toBe('reviewPending');
  });

  it('knows which transitions are legal', () => {
    expect(canTransition('proposed', 'reviewPending')).toBe(true);
    expect(canTransition('verified', 'applying')).toBe(false);
    expect(canTransition('rejected', 'accepted')).toBe(false);
  });

  it('records accepted hunks per file', () => {
    const { store, changeSet } = storeWithProposal();
    const hunkId = changeSet.files[0]!.hunks[0]!.id;
    store.setAccepted(changeSet.id, 'src/a.ts', new Set([hunkId]));
    expect(store.get(changeSet.id)?.files[0]?.accepted.has(hunkId)).toBe(true);
  });

  it('accepts and rejects everything', () => {
    const { store, changeSet } = storeWithProposal();
    store.acceptAll(changeSet.id);
    expect(store.get(changeSet.id)?.files[0]?.accepted.size).toBe(1);
    store.rejectAll(changeSet.id);
    expect(store.get(changeSet.id)?.files[0]?.accepted.size).toBe(0);
  });

  it('lists the pending change sets', () => {
    const store = new ChangeStore();
    const one = store.create([fileChange('a.ts')]);
    store.create([fileChange('b.ts')]);
    store.transition(one.id, 'reviewPending');
    expect(store.pending().length).toBe(1);
    expect(store.pending()[0]?.files[0]?.path).toBe('a.ts');
  });

  it('emits events for the UI', () => {
    const store = new ChangeStore();
    const seen: string[] = [];
    store.onEvent((e) => seen.push(e.type));
    const changeSet = store.create([fileChange()]);
    store.transition(changeSet.id, 'reviewPending');
    store.setAccepted(changeSet.id, 'src/a.ts', new Set());
    expect(seen).toContain('created');
    expect(seen).toContain('stateChanged');
    expect(seen).toContain('decisionChanged');
  });

  it('never lets a broken listener break the store', () => {
    const store = new ChangeStore();
    store.onEvent(() => { throw new Error('boom'); });
    const changeSet = store.create([fileChange()]);
    expect(() => store.transition(changeSet.id, 'reviewPending')).not.toThrow();
  });

  it('throws for an unknown change set', () => {
    const store = new ChangeStore();
    expect(() => store.transition('nope', 'reviewPending')).toThrow(/unknown change set/);
  });
});
