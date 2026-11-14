import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Path guard (FR-3/FR-4): every tool path resolves (realpath) inside a
 * workspace root, with a segment deny list. Symlinks are resolved before the
 * containment check, so a link pointing outside the workspace is refused.
 */

export type PathGuardErrorCode = 'outside_workspace' | 'denied' | 'not_found' | 'secret';

export class PathGuardError extends Error {
  readonly code: PathGuardErrorCode;
  constructor(code: PathGuardErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PathGuardOptions {
  /** Absolute workspace root(s); realpath'd lazily at check time. */
  roots: string[];
  /** Path segments that may never appear (default: .git). */
  denySegments?: string[];
  /**
   * Allow reads of secret-looking files (.env, *.pem, id_rsa). Off by default
   * (PRD section 8): the user must opt in via settings.
   */
  allowSecrets?: boolean;
}

export interface ResolvedPath {
  /** Realpath'd absolute path. */
  absolute: string;
  /** Realpath'd workspace root that contains it. */
  root: string;
}

const DEFAULT_DENY = ['.git'];

/** Secret-looking file names: denied for reads unless explicitly allowed. */
export function isSecretFile(name: string): boolean {
  const base = name.toLowerCase();
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    base.endsWith('.pem') ||
    base === 'id_rsa' ||
    base === 'id_dsa' ||
    base === 'id_ecdsa' ||
    base === 'id_ed25519'
  );
}

export class PathGuard {
  private readonly deny: string[];

  constructor(private readonly options: PathGuardOptions) {
    this.deny = options.denySegments ?? DEFAULT_DENY;
  }

  /**
   * Resolve `input` (workspace-relative or absolute) to a realpath'd absolute
   * path inside a workspace root. `mustExist`: the file itself must exist;
   * otherwise the nearest existing ancestor is realpath'd (for future create).
   */
  async resolve(input: string, opts: { mustExist?: boolean } = {}): Promise<ResolvedPath> {
    const clean = input.trim();
    if (!clean) {
      throw new PathGuardError('outside_workspace', 'empty path');
    }
    if (this.deny.some((seg) => clean.split(/[\\/]+/).includes(seg))) {
      throw new PathGuardError('denied', `path segment is denied: ${clean}`);
    }

    const rootsReal = (await Promise.all(this.options.roots.map((r) => realpathSafe(r)))).filter(
      (r): r is string => r !== undefined,
    );
    if (rootsReal.length === 0) {
      throw new PathGuardError('outside_workspace', 'no workspace roots available');
    }

    const candidates = path.isAbsolute(clean)
      ? [clean]
      : rootsReal.map((r) => path.join(r, clean));

    for (const candidate of candidates) {
      const target = await realpathSafe(candidate);
      if (target) {
        const root = rootsReal.find((r) => isInside(r, target));
        if (!root) {
          // Resolved (possibly via symlink) to somewhere outside every root.
          throw new PathGuardError('outside_workspace', `path resolves outside the workspace: ${input}`);
        }
        this.assertNotSecret(target);
        return { absolute: target, root };
      }
      // realpath failed (not exists or unreadable): fall through
    }

    // Not found directly (or target outside workspace): try the nearest
    // existing ancestor so we can distinguish not_found from escape.
    for (const candidate of candidates) {
      const ancestorReal = await this.nearestExistingAncestor(candidate);
      if (ancestorReal) {
        const { real, original } = ancestorReal;
        const root = rootsReal.find((r) => isInside(r, real));
        if (!root) {
          throw new PathGuardError('outside_workspace', `path resolves outside the workspace: ${input}`);
        }
        if (opts.mustExist !== false) {
          throw new PathGuardError('not_found', `path does not exist: ${input}`);
        }
        // Re-join the non-existing remainder under the realpath'd ancestor.
        const remainder = path.relative(candidate, original);
        const absolute = path.join(real, remainder);
        this.assertNotSecret(absolute);
        return { absolute, root };
      }
    }

    throw new PathGuardError('not_found', `path does not exist: ${input}`);
  }

  /** Secret-looking files are refused unless the user opted in (PRD §8). */
  private assertNotSecret(absolute: string): void {
    if (this.options.allowSecrets) { return; }
    const base = path.basename(absolute);
    if (isSecretFile(base)) {
      throw new PathGuardError(
        'secret',
        `refusing to read a secret file (${base}). Enable "TrueGuard: Allow Secret Reads" to allow it.`,
      );
    }
  }

  private async nearestExistingAncestor(
    candidate: string,
  ): Promise<{ real: string; original: string } | undefined> {
    let current = candidate;
    for (let i = 0; i < 64; i++) {
      const real = await realpathSafe(current);
      if (real) {
        return { real, original: current };
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
    return undefined;
  }
}

async function realpathSafe(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/** True when `child` equals or lives under `parent` (both absolute). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
