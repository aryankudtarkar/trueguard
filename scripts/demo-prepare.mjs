/**
 * Prepare the demo: clone the benchmark repository the brief pins,
 * check out the exact commit and write the three demo prompts.
 *
 * The brief (docs/BRIEF_NOTES.md): "Repository: pallets/flask, tag 3.1.3
 * (commit 22d92470)".
 *
 * Usage: node scripts/demo-prepare.mjs [targetDir]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The benchmark: the repository and the commit the brief pins. */
const REPO = 'https://github.com/pallets/flask.git';
const COMMIT = '22d92470'; // tag 3.1.3
const TAG = '3.1.3';

const target = process.argv[2] ?? join(process.cwd(), 'demo', 'flask');

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true });
  console.log(`cloning ${REPO} into ${target}…`);
  run('git', ['clone', REPO, target]);
}
try {
  run('git', ['checkout', COMMIT], target);
  console.log(`checked out ${COMMIT} (tag ${TAG})`);
} catch {
  console.log(`could not check out ${COMMIT}: is the tag ${TAG} present?`);
}

const prompts = [
  {
    id: 'A',
    title: 'Inline edit (single file)',
    prompt:
      'Treat the values "off" and "n" as false as well, case-insensitively, and update the ' +
      'docstring to list every value that is treated as false.',
    file: 'src/flask/helpers.py',
    symbol: 'get_debug_flag',
    verify: 'FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"',
  },
  {
    id: 'B',
    title: 'Agent mode (3 or more files, none named)',
    prompt:
      "Add a new built-in CLI command `flask config` that prints the loaded application's " +
      'configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN ' +
      'or KEY as "***". It must appear in `flask --help`, be covered by a test, and be ' +
      'documented alongside the other built-in commands.',
    verify: 'pytest tests/test_cli.py -q',
  },
  {
    id: 'C',
    title: 'Resilience',
    prompt: 'Repeat Task A with the provider unreachable or the key invalid.',
    verify: 'git status --porcelain  # must be empty',
  },
];

writeFileSync(
  join(target, 'TRUEGUARD-DEMO.md'),
  [
    '# TrueGuard demo — the three fixed tasks (brief, Round 1)',
    '',
    `Benchmark: pallets/flask at ${COMMIT} (tag ${TAG})`,
    '',
    ...prompts.flatMap((p) => [
      `## Task ${p.id} — ${p.title}`,
      '',
      `**Ask:** ${p.prompt}`,
      ...(p.file ? [`**File:** ${p.file}${p.symbol ? ` (\`${p.symbol}\`)` : ''}`] : []),
      `**Verify:** \`${p.verify}\``,
      '',
    ]),
    '## TrueForge session (Task B)',
    '',
    'The TrueForge web UI is at http://localhost:8790 — show the session while Task B runs.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`demo ready in ${target}`);
console.log('the three tasks are written to TRUEGUARD-DEMO.md');
