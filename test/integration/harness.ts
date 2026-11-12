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
} {
  return {
    toBe(expected): void {
      if (actual !== expected) { throw new Error(`expected ${String(expected)} got ${String(actual)}`); }
    },
    toContain(expected): void {
      const list = actual as unknown[];
      if (!Array.isArray(list) || !list.includes(expected)) {
        throw new Error(`expected collection to contain ${String(expected)}`);
      }
    },
    toBeInstanceOf(cls): void {
      if (!(actual instanceof cls)) { throw new Error(`expected instance of ${String(cls)}`); }
    },
    toMatch(re): void {
      const s = String(actual);
      const ok = typeof re === 'string' ? s.includes(re) : re.test(s);
      if (!ok) { throw new Error(`expected ${s} to match ${String(re)}`); }
    },
    toBeUndefined(): void {
      if (actual !== undefined) { throw new Error(`expected undefined got ${String(actual)}`); }
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
