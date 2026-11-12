/**
 * Mutex serializing async critical sections per key (e.g. per-file applies).
 */
export class MutexMap {
  private locks = new Map<string, Promise<void>>();

  /** Run `fn` exclusively for `key`. Other callers for the same key queue. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn); // proceed even if the previous threw
    // Keep the queue entry only while callers may still be waiting on it;
    // a settled entry is replaced by the next run() call anyway.
    this.locks.set(key, next.then(() => undefined, () => undefined));
    return next;
  }
}
