import { describe, expect, it } from 'vitest';
import { FaultHook } from '../../src/edits/faults';

describe('fault hook', () => {
  it('does nothing until it is armed', () => {
    const hook = new FaultHook();
    expect(hook.consumeCorruptNextWrite()).toBe(false);
  });

  it('corrupts exactly one write after being armed', () => {
    const hook = new FaultHook();
    hook.armCorruptNextWrite();
    expect(hook.armed).toBe(true);
    expect(hook.consumeCorruptNextWrite()).toBe(true);
    expect(hook.consumeCorruptNextWrite()).toBe(false);
    expect(hook.armed).toBe(false);
  });

  it('can be reset', () => {
    const hook = new FaultHook();
    hook.armCorruptNextWrite();
    hook.reset();
    expect(hook.consumeCorruptNextWrite()).toBe(false);
  });
});
