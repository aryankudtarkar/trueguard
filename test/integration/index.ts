// Entry loaded by @vscode/test-electron inside the extension host.
// Importing the suite files registers describe/it with the harness.
import { runAll } from './harness';
import './extension.test';
import './mcp.test';
import './gitignore-probe.test';

export async function run(): Promise<void> {
  // The extension activates automatically (activationEvents); give it a beat.
  await new Promise((r) => setTimeout(r, 500));
  await runAll();
}
