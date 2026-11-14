#!/usr/bin/env node
/**
 * One command to get TrueGuard running.
 *
 *   npm run dev
 *
 * It starts whatever is missing, registers the provider, and prints what is
 * ready. Safe to run again at any time.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const FAKE_LLM_URL = process.env.FAKE_LLM_URL ?? 'http://127.0.0.1:8799';

const children = [];

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function startInBackground(name, cmd, args, readyUrl) {
  const child = run(cmd, args);
  children.push(child);
  child.stdout.on('data', (d) => process.stdout.write(`  [${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`  [${name}] ${d}`));
  console.log(`  started ${name} (${cmd} ${args.join(' ')})`);
  return child;
}

async function up(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(url, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await up(url)) { return true; }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`  ! ${label} did not answer within ${seconds}s`);
  return false;
}

async function main() {
  console.log('TrueGuard — getting you ready\n');

  // 1. the model provider (a fake one: no API key needed)
  if (await up(FAKE_LLM_URL)) {
    console.log('  ✓ model provider already running on :8799');
  } else {
    const script = join(ROOT, 'spikes', 'fake-openai.mjs');
    if (!existsSync(script)) {
      console.error('  ! spikes/fake-openai.mjs is missing');
    } else {
      startInBackground('provider', process.execPath, [script]);
      await waitFor(FAKE_LLM_URL, 5, 'the model provider');
    }
  }

  // 2. the agent harness
  if (await up(`${BASE_URL}/api/v1/users`)) {
    console.log('  ✓ TrueForge already running on :8790');
  } else {
    console.log('  starting TrueForge (the first run downloads it, this takes a minute)…');
    startInBackground('trueforge', 'npx', ['@truefoundry/trueforge@latest'], { env: { ...process.env, PORT: '8790' } });
    await waitFor(`${BASE_URL}/api/v1/users`, 90, 'TrueForge');
  }

  // 3. register the provider with TrueForge
  console.log('\n  registering the development provider…');
  await new Promise((resolve) => {
    const setup = run(process.execPath, [join(ROOT, 'scripts', 'setup-trueforge.mjs')]);
    setup.stdout.on('data', (d) => process.stdout.write(`  ${d}`));
    setup.stderr.on('data', (d) => process.stderr.write(`  ${d}`));
    setup.on('close', resolve);
  });

  console.log('\nTrueGuard is ready. Next:');
  console.log('  1. open the folder in VS Code and press F5 (Run Extension)');
  console.log('  2. click the TrueGuard icon in the Activity Bar');
  console.log('  3. run "TrueGuard: Check Setup" if anything looks wrong');
  console.log('\nKeep this terminal open. Ctrl+C stops both processes.');

  const stop = () => {
    for (const child of children) { child.kill('SIGTERM'); }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
