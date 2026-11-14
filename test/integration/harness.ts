/**
 * Minimal vitest-compatible harness for tests that must run inside the VS Code
 * extension host (see test/integration). Bundled by esbuild with the
 * `vitest` import aliased to this module.
 */
type TestFn = () => void | Promise<void>;

interface TestCase { name: string; fn: TestFn }
interface Suite { name: string; cases: TestCase[] }

const suites: Suite[] = [];
let current: Suite | undefined;

export function describe(name: string, fn: () => void): void {
  const suite: Suite = { name, cases: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  fn();
  current = prev;
}

export function it(name: string, fn: TestFn): void {
  current?.cases.push({ name, fn });
}

export function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeInstanceOf(cls: new () => unknown): void;
  toMatch(re: RegExp | string): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeTruthy(): void;
  not: {
    toBe(expected: unknown): void;
    toContain(expected: unknown): void;
    toMatch(re: RegExp | string): void;
    toBeUndefined(): void;
  };
} {
  const matchers = {
    toBe(expected: unknown): void {
      if (actual !== expected) { throw new Error(`expected ${String(expected)} got ${String(actual)}`); }
    },
    toContain(expected: unknown): void {
      if (typeof actual === 'string') {
        if (!actual.includes(String(expected))) {
          throw new Error(`expected ${actual} to contain ${String(expected)}`);
        }
        return;
      }
      const list = actual as unknown[];
      if (!Array.isArray(list) || !list.includes(expected)) {
        throw new Error(`expected collection to contain ${String(expected)}`);
      }
    },
    toBeInstanceOf(cls: new () => unknown): void {
      if (!(actual instanceof cls)) { throw new Error(`expected instance of ${String(cls)}`); }
    },
    toMatch(re: RegExp | string): void {
      const s = String(actual);
      const ok = typeof re === 'string' ? s.includes(re) : re.test(s);
      if (!ok) { throw new Error(`expected ${s} to match ${String(re)}`); }
    },
    toBeUndefined(): void {
      if (actual !== undefined) { throw new Error(`expected undefined got ${String(actual)}`); }
    },
    toBeDefined(): void {
      if (actual === undefined) { throw new Error('expected defined'); }
    },
    toBeGreaterThan(expected: number): void {
      if (!(typeof actual === 'number' && actual > expected)) {
        throw new Error(`expected ${String(actual)} to be greater than ${String(expected)}`);
      }
    },
    toBeTruthy(): void {
      if (!actual) { throw new Error(`expected ${String(actual)} to be truthy`); }
    },
  };
  return {
    ...matchers,
    not: {
      toBe(expected: unknown): void {
        if (actual === expected) { throw new Error(`expected not ${String(expected)}`); }
      },
      toContain(expected: unknown): void {
        if (typeof actual === 'string') {
          if (actual.includes(String(expected))) {
            throw new Error(`expected ${actual} not to contain ${String(expected)}`);
          }
          return;
        }
        const list = actual as unknown[];
        if (Array.isArray(list) && list.includes(expected)) {
          throw new Error(`expected collection not to contain ${String(expected)}`);
        }
      },
      toMatch(re: RegExp | string): void {
        const s = String(actual);
        const ok = typeof re === 'string' ? s.includes(re) : re.test(s);
        if (ok) { throw new Error(`expected ${s} not to match ${String(re)}`); }
      },
      toBeUndefined(): void {
        if (actual === undefined) { throw new Error('expected not undefined'); }
      },
    },
  };
}

export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: string[] = [];
  for (const suite of suites) {
    for (const c of suite.cases) {
      try {
        await c.fn();
        passed++;
        console.log(`✓ ${suite.name} > ${c.name}`);
      } catch (e) {
        failures.push(`${suite.name} > ${c.name}: ${String(e)}`);
        console.error(`× ${suite.name} > ${c.name}: ${String(e)}`);
      }
    }
  }
  console.log(`integration: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { throw new Error(failures.join('\n')); }
}
