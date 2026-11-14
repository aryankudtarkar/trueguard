import * as vscode from 'vscode';
import { logger } from '../util/logger';

/**
 * Setup doctor.
 *
 * One command answers "is TrueGuard ready, and if not, what do I do?".
 * Every check carries the action that fixes it, so the user is never left
 * with a dead end.
 */

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** What to do about it. */
  fix?: { label: string; command: string; args?: unknown[] };
}

export interface DoctorDeps {
  /** Is the TrueForge server answering? */
  serverUp(): Promise<boolean>;
  /** The models TrueForge knows about. */
  models(): Promise<Array<{ provider: string; model: string }>>;
  /** Is our MCP server listening? */
  editorServerUp(): boolean;
  /** Is the connector registered in TrueForge? */
  connectorRegistered(): Promise<boolean>;
  /** The models the active mode would use. */
  activeModels(): Array<{ label: string; ref: string }>;
}

/** Run every check. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const serverUp = await deps.serverUp();
  checks.push({
    name: 'TrueForge server',
    ok: serverUp,
    detail: serverUp ? 'Answering on the configured address.' : 'Not answering.',
    ...(serverUp ? {} : { fix: { label: 'Start TrueForge', command: 'trueguard.startTrueForge' } }),
  });

  const models = serverUp ? await deps.models().catch(() => []) : [];
  checks.push({
    name: 'Models',
    ok: models.length > 0,
    detail: models.length
      ? `${models.length} available: ${models.slice(0, 3).map((m) => `${m.provider}/${m.model}`).join(', ')}`
      : 'TrueForge knows no model yet.',
    ...(models.length ? {} : { fix: { label: 'Configure Providers', command: 'trueguard.configureProviders' } }),
  });

  const active = deps.activeModels();
  checks.push({
    name: 'Active mode',
    ok: active.length > 0,
    detail: active.length ? `Using ${active[0]?.ref}.` : 'No model for the active mode.',
    ...(active.length
      ? { fix: { label: 'Switch mode or model', command: 'trueguard.switchMode' } }
      : { fix: { label: 'Configure Providers', command: 'trueguard.configureProviders' } }),
  });

  checks.push({
    name: 'Editor tools (MCP)',
    ok: deps.editorServerUp(),
    detail: deps.editorServerUp() ? 'Listening on loopback.' : 'Not listening.',
    ...(deps.editorServerUp() ? {} : { fix: { label: 'Reload the window', command: 'workbench.action.reloadWindow' } }),
  });

  const connector = serverUp ? await deps.connectorRegistered().catch(() => false) : false;
  checks.push({
    name: 'Connector in TrueForge',
    ok: connector,
    detail: connector ? 'Registered.' : 'Not registered — the agent cannot use the editor tools.',
    ...(connector ? {} : { fix: { label: 'Reload the window', command: 'workbench.action.reloadWindow' } }),
  });

  return checks;
}

/** Show the report and offer the fixes. */
export async function showDoctor(checks: DoctorCheck[]): Promise<void> {
  const broken = checks.filter((c) => !c.ok);
  if (!broken.length) {
    void vscode.window.showInformationMessage(
      `TrueGuard is ready: ${checks.map((c) => c.name).join(', ')} — all good.`,
    );
    return;
  }
  logger().info(`doctor: ${broken.map((c) => `${c.name} — ${c.detail}`).join('; ')}`);
  const items = broken.map((c) => ({
    label: c.name,
    description: c.detail,
    action: c.fix?.label ?? 'Show the log',
    command: c.fix?.command ?? 'trueguard.showSessionLog',
    args: c.fix?.args,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'TrueGuard is not ready yet — what do you want to do?',
  });
  if (!pick) { return; }
  await vscode.commands.executeCommand(pick.command, ...(pick.args ?? []));
}
