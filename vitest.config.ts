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
      include: ['src/edits/**', 'src/failover/**', 'src/mcp/**', 'src/util/**'],
    },
  },
});