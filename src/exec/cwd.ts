import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Working directory guard for commands (FR-6).
 *
 * A command may only run inside a workspace folder. Absolute paths outside
 * the workspace and paths that escape it with `..` are refused.
 */

/** Is `candidate` inside one of the roots (after resolving symlinks)? */
export function isInsideRoot(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(root + path.sep));
}

/**
 * Resolve a requested working directory against the workspace roots.
 * Returns undefined when the directory does not exist or escapes the workspace.
 */
export async function resolveCommandCwd(
  cwd: string | undefined,
  roots: readonly string[],
): Promise<string | undefined> {
  if (!roots.length) { return undefined; }
  const root = roots[0]!;
  const candidate = !cwd
    ? root
    : path.isAbsolute(cwd)
      ? cwd
      : path.join(root, cwd);
  const real = await realpath(candidate).catch(() => undefined);
  if (!real) { return undefined; }
  // The roots are resolved too: on macOS /var is a symlink to /private/var,
  // so a string comparison against the unresolved root would fail.
  const realRoots = await Promise.all(
    roots.map(async (r) => (await realpath(r).catch(() => undefined)) ?? r),
  );
  return isInsideRoot(real, realRoots) ? real : undefined;
}
