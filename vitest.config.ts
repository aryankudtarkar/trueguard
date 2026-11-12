import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // The live exit-gate tests share external state (the fake OpenAI provider's
    // mode and the real TrueForge server), so files must not run in parallel.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The PRD sets a coverage bar on the risky modules. vscodeTools.ts and
      // vscodeBridge.ts are excluded on purpose: they only run against the
      // real VS Code API and are covered by the integration suite instead.
      include: [
        'src/edits/apply.ts',
        'src/edits/hunks.ts',
        'src/edits/matcher.ts',
        'src/edits/proposal.ts',
        'src/edits/store.ts',
        'src/edits/text.ts',
        'src/exec/**',
        'src/failover/**',
        'src/mcp/tools.ts',
        'src/mcp/pathGuard.ts',
        'src/mcp/editorServer.ts',
        'src/util/truncate.ts',
        'src/util/jsonCap.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
        // The PRD sets a higher bar on the trust-critical modules.
        'src/edits/**': { lines: 90, functions: 90 },
        'src/mcp/tools.ts': { lines: 90, functions: 90 },
        // The Windows-only kill path cannot be exercised on macOS/Linux.
        'src/exec/runner.ts': { lines: 70, functions: 60, branches: 65 },
        'src/failover/**': { lines: 85 },
      },
    },
  },
});
