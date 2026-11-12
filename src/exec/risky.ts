/**
 * Risky command patterns (PRD FR-6).
 *
 * The patterns are HIGHLIGHTED, never silently blocked: the user sees the
 * exact command and decides. Blocking is the user's call, not ours.
 */

export interface RiskyPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

export const RISKY_PATTERNS: readonly RiskyPattern[] = [
  { id: 'rm-rf', label: 'recursive delete', pattern: /\brm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f|\brm\s+(-[a-z]*f[a-z]*r)\b/i },
  { id: 'sudo', label: 'runs as root', pattern: /(^|[;&|]\s*)sudo\b/i },
  { id: 'git-push', label: 'pushes to a remote', pattern: /\bgit\s+push\b/i },
  { id: 'git-reset-hard', label: 'discards local work', pattern: /\bgit\s+reset\s+--hard\b/i },
  { id: 'git-clean', label: 'removes untracked files', pattern: /\bgit\s+clean\b/i },
  { id: 'curl-pipe-shell', label: 'pipes a download into a shell', pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { id: 'chmod-recursive', label: 'changes permissions recursively', pattern: /\bchmod\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*R/i },
  { id: 'dd', label: 'writes raw devices', pattern: /\bdd\s+if=/i },
  { id: 'mkfs', label: 'formats a filesystem', pattern: /\bmkfs(\.[a-z0-9]+)?\b/i },
  { id: 'shutdown', label: 'shuts the machine down', pattern: /\b(shutdown|reboot|halt)\b/i },
  { id: 'kill', label: 'kills processes', pattern: /\b(pkill|killall)\b/i },
  { id: 'history', label: 'reads shell history', pattern: /\bhistory\b|\.bash_history\b/i },
  { id: 'credential', label: 'touches credentials', pattern: /(\.ssh\/|\.aws\/|credentials|\.netrc|\.pem\b|id_rsa)/i },
];

/** Which risky patterns a command matches (empty when it looks harmless). */
export function findRiskyPatterns(command: string): RiskyPattern[] {
  return RISKY_PATTERNS.filter((p) => p.pattern.test(command));
}

/** One-line summary for the approval card. */
export function describeRisky(patterns: readonly RiskyPattern[]): string {
  if (!patterns.length) { return ''; }
  return `This command ${patterns.map((p) => p.label).join(', ')}.`;
}
