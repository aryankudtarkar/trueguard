/**
 * Dev-only fault injection (Phase 3.7).
 *
 * The demo needs to show that a corrupted write is caught and rolled back.
 * The hook is armed by an explicit command and only works when the developer
 * flags allow it, so it can never fire in a normal session.
 */

export class FaultHook {
  private corruptNextWrite = false;

  /** Arm the fault: the next write is deliberately corrupted. */
  armCorruptNextWrite(): void {
    this.corruptNextWrite = true;
  }

  /** True when a write should be corrupted; consumes the arming. */
  consumeCorruptNextWrite(): boolean {
    if (!this.corruptNextWrite) { return false; }
    this.corruptNextWrite = false;
    return true;
  }

  get armed(): boolean {
    return this.corruptNextWrite;
  }

  reset(): void {
    this.corruptNextWrite = false;
  }
}
