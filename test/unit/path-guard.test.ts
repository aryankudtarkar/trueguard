import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PathGuard, isInside, isSecretFile } from '../../src/mcp/pathGuard';

const ROOTS: string[] = [];
let outsideDir: string;
let realRoot: string;
let wsRoot: string;
let tmpRoot: string;

beforeAll(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trueguard-pg-'));
  tmpRoot = root;
  wsRoot = path.join(root, 'ws');
  ROOTS.push(wsRoot);
  await mkdir(path.join(root, 'outside'), { recursive: true });
  await mkdir(wsRoot, { recursive: true });
  outsideDir = path.join(root, 'outside');
  await writeFile(path.join(wsRoot, 'a.ts'), 'export {};\n');
  await writeFile(path.join(outsideDir, 'secret.txt'), 'secret');
  await symlink(outsideDir, path.join(wsRoot, 'link-out')); // symlink escape
  realRoot = await realpath(ROOTS[0] ?? wsRoot); // macOS /var → /private/var
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function guard(): PathGuard {
  return new PathGuard({ roots: ROOTS });
}

describe('path guard', () => {
  it('resolves a valid workspace-relative path to its realpath', async () => {
    const r = await guard().resolve('a.ts', { mustExist: true });
    expect(r.absolute).toBe(path.join(realRoot, 'a.ts'));
    expect(r.root).toBe(realRoot);
  });

  it('rejects .. escapes', async () => {
    await expect(guard().resolve('../outside/secret.txt', { mustExist: true }))
      .rejects.toMatchObject({ code: 'outside_workspace' });
  });

  it('rejects absolute paths outside the workspace', async () => {
    await expect(guard().resolve(outsideDir + '/secret.txt', { mustExist: true }))
      .rejects.toMatchObject({ code: 'outside_workspace' });
  });

  it('rejects symlink escapes even when the link itself is inside', async () => {
    await expect(guard().resolve('link-out/secret.txt', { mustExist: true }))
      .rejects.toMatchObject({ code: 'outside_workspace' });
  });

  it('enforces the segment deny list (.git)', async () => {
    await expect(guard().resolve('.git/config', { mustExist: true }))
      .rejects.toMatchObject({ code: 'denied' });
    await expect(guard().resolve('src/.git/hooks', { mustExist: true }))
      .rejects.toMatchObject({ code: 'denied' });
  });

  it('reports not_found for missing files inside the workspace', async () => {
    await expect(guard().resolve('missing.ts', { mustExist: true }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('recognizes the secret file names', () => {
    expect(isSecretFile('.env')).toBe(true);
    expect(isSecretFile('.env.local')).toBe(true);
    expect(isSecretFile('production.env')).toBe(true);
    expect(isSecretFile('server.pem')).toBe(true);
    expect(isSecretFile('id_rsa')).toBe(true);
    expect(isSecretFile('app.ts')).toBe(false);
    expect(isSecretFile('environment.ts')).toBe(false);
  });

  it('isInside: exact root and nested pass; parent traversal fails', () => {
    expect(isInside('/w', '/w')).toBe(true);
    expect(isInside('/w', '/w/sub/f.ts')).toBe(true);
    expect(isInside('/w', '/w2')).toBe(false);
    expect(isInside('/w', '/other/f.ts')).toBe(false);
  });
});
