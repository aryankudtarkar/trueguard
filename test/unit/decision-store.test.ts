import { describe, expect, it } from 'vitest';
import { DecisionStore } from '../../src/review/decisionStore';

describe('decision store', () => {
  it('stores a decision and hands it out once', () => {
    const store = new DecisionStore();
    store.set({ toolCallId: 'call_1', changeSetId: 'c1', status: 'allow', hunks: [] });
    expect(store.has('call_1')).toBe(true);
    const decision = store.take('call_1');
    expect(decision?.status).toBe('allow');
    expect(store.take('call_1')).toBeUndefined();
  });

  it('wakes a waiting handler as soon as the decision arrives', async () => {
    const store = new DecisionStore();
    const waiting = store.waitFor('call_1', 1000);
    store.set({ toolCallId: 'call_1', changeSetId: 'c1', status: 'deny', hunks: [] });
    const decision = await waiting;
    expect(decision?.status).toBe('deny');
  });

  it('resolves undefined when nobody decides', async () => {
    const store = new DecisionStore();
    expect(await store.waitFor('call_x', 20)).toBeUndefined();
  });

  it('takes the oldest decision when the id is unknown', () => {
    const store = new DecisionStore();
    store.set({ toolCallId: 'call_1', changeSetId: 'c1', status: 'allow', hunks: [] });
    store.set({ toolCallId: 'call_2', changeSetId: 'c2', status: 'deny', hunks: [] });
    expect(store.takeOldest()?.toolCallId).toBe('call_1');
    expect(store.takeOldest()?.toolCallId).toBe('call_2');
    expect(store.takeOldest()).toBeUndefined();
  });

  it('waits for any decision when the id is unknown', async () => {
    const store = new DecisionStore();
    const waiting = store.waitForAny(1000);
    store.set({ toolCallId: 'call_9', changeSetId: 'c9', status: 'allow', hunks: [] });
    expect((await waiting)?.toolCallId).toBe('call_9');
  });

  it('denies everything that is still waiting', async () => {
    const store = new DecisionStore();
    const waiting = store.waitFor('call_1', 1000);
    store.denyAll(['call_1'], 'stopped');
    const decision = await waiting;
    expect(decision?.status).toBe('deny');
    expect(decision?.reason).toBe('stopped');
  });

  it('keeps the accepted hunk ids with the decision', () => {
    const store = new DecisionStore();
    store.set({
      toolCallId: 'call_1',
      changeSetId: 'c1',
      status: 'allow',
      hunks: [{ path: 'src/a.ts', accepted: ['h1', 'h3'] }],
    });
    expect(store.take('call_1')?.hunks[0]?.accepted).toEqual(['h1', 'h3']);
  });
});
