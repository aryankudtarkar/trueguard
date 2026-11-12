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
      // The PRD sets a coverage bar on the risky modules. vscodeTools.ts is
      // excluded on purpose: it only runs against the real VS Code API and is
      // covered by the integration suite instead.
      include: [
        'src/edits/**',
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
      },
    },
  },
});
