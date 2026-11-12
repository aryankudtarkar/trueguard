// Integration test runner: launches VS Code with @vscode/test-electron and runs
// the bundled suites in test/integration against the real VS Code API.
import pkg from '@vscode/test-electron';
const { runTests, downloadAndUnzipVSCode } = pkg;
import { resolve } from 'node:path';

async function main() {
  const extensionDevelopmentPath = resolve(process.cwd());
  const extensionTestsPath = resolve(process.cwd(), 'out', 'test-integration', 'index.js');
  // Slow networks need a longer idle timeout than the 15 s default.
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ timeout: 120_000 });
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    vscodeExecutablePath,
    launchArgs: ['--disable-extensions'],
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('Integration tests failed:', err);
    process.exit(1);
  },
);
