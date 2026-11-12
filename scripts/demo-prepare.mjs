#!/usr/bin/env node
/**
 * Prepare the demo: clone the benchmark repository (a small, real project),
 * pin a commit and write the demo prompts.
 *
 * Usage: node scripts/demo-prepare.mjs [targetDir]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The benchmark: a small, readable project with tests. */
const REPO = 'https://github.com/pallets/flask.git';
const COMMIT = '3e1c4d1a1a2d5b5e0b0e2a4c1f4b6d8e9a0b1c2d'; // pinned for the demo

const target = process.argv[2] ?? join(process.cwd(), 'demo', 'flask');

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true });
  console.log(`cloning ${REPO} into ${target}…`);
  run('git', ['clone', '--depth', '50', REPO, target]);
  try {
    run('git', ['checkout', COMMIT], target);
    console.log(`pinned to ${COMMIT}`);
  } catch {
    console.log('the pinned commit is not in the shallow clone: using the tip');
  }
}

const prompts = [
  'Add a docstring to the calculate_total function and handle an empty list.',
  'Add type hints to the functions in app/calculate.py.',
  'Write a test for the empty-list case.',
  'Run the tests and tell me what fails.',
];

writeFileSync(
  join(target, 'FORGEGUARD-DEMO.md'),
  [
    '# ForgeGuard demo prompts',
    '',
    'Ask ForgeGuard, one at a time:',
    '',
    ...prompts.map((p, i) => `${i + 1}. ${p}`),
    '',
  ].join('\n'),
  'utf8',
);

console.log(`demo ready in ${target}`);
console.log('prompts written to FORGEGUARD-DEMO.md');
