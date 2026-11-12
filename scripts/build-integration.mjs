import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, '..', 'test', 'integration', 'harness.ts');

/** Bundles the integration suites + entry for @vscode/test-electron. */
await esbuild.build({
  entryPoints: ['test/integration/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: 'out/test-integration/index.js',
  external: ['vscode'],
  alias: { vitest: harness },
  sourcemap: true,
  logLevel: 'info',
});
