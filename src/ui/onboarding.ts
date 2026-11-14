import * as vscode from 'vscode';
import { logger } from '../util/logger';
import { PROVIDER_PRESETS, type ProviderPreset } from '../providers/presets';
import type { TrueForgeClient } from '../trueforge/client';
import { configureProviders } from '../providers/setup';

/**
 * First run (Phase 1).
 *
 * The user must end up with a working agent, and they must know what is
 * happening at every step. Two paths:
 *
 *  - the real path: paste a Groq and an NVIDIA NIM key (once, into the
 *    secret storage). The providers are registered in TrueForge and the modes
 *    are filled in.
 *  - the development path: use the local fake provider. It is offered
 *    honestly, and the user is told what it can and cannot do.
 *
 * The onboarding is only "done" when the user finishes it or explicitly
 * chooses the development path — never optimistically.
 */

export interface OnboardingDeps {
  client: TrueForgeClient;
  secrets: vscode.SecretStorage;
  /** The models TrueForge knows about. */
  availableModels(): Promise<Array<{ provider: string; model: string }>>;
  /** The models the active mode would use right now. */
  activeModels(): Array<{ label: string; ref: string }>;
  /** Write a mode's model chain. */
  setModeModels(mode: string, models: Array<{ id: string; label: string; ref: string }>): Promise<void>;
  /** The default chain of a mode. */
  defaultModels(mode: string): Array<{ id: string; label: string; ref: string }>;
  /** The provider of a mode's default model. */
  modeProvider(mode: string): string | undefined;
}

export const ONBOARDING_KEY = 'trueguard.onboarded';
export const ONBOARDING_SKIPPED_KEY = 'trueguard.onboardingSkipped';

/** Is the onboarding finished (or deliberately skipped)? */
export function onboardingDone(state: vscode.Memento): boolean {
  return Boolean(state.get<boolean>(ONBOARDING_KEY) || state.get<boolean>(ONBOARDING_SKIPPED_KEY));
}

/**
 * The first-run flow. Returns true when the user ends up with a working
 * setup.
 */
export async function runOnboarding(deps: OnboardingDeps, state: vscode.Memento): Promise<boolean> {
  logger().info('onboarding: starting');

  const choice = await vscode.window.showInformationMessage(
    'TrueGuard needs a model to talk to. Add a provider key, or try the local development provider.',
    { modal: true, detail: 'Groq and NVIDIA NIM keys are stored in VS Code’s secret storage — never in your settings or your repository.' },
    'Add a provider key',
    'Use the development provider',
  );

  if (choice === 'Use the development provider') {
    await state.update(ONBOARDING_SKIPPED_KEY, true);
    await fillModeModels(deps);
    void vscode.window.showInformationMessage(
      'Using the development provider. It searches your workspace and quotes your code — it does not reason. Add a key any time with "TrueGuard: Configure Providers".',
    );
    return true;
  }
  if (choice !== 'Add a provider key') {
    // Cancelled: the onboarding stays unfinished and is offered again.
    return false;
  }

  const result = await configureProviders({
    client: deps.client,
    secrets: deps.secrets,
    report: (message) => void vscode.window.showInformationMessage(message),
  });

  if (!result.registered.length) {
    void vscode.window.showWarningMessage(
      'No provider was registered, so TrueGuard cannot talk to a model yet. Run "TrueGuard: Configure Providers" when you are ready.',
    );
    return false;
  }
  await fillModeModels(deps);
  await state.update(ONBOARDING_KEY, true);
  return true;
}

/** Fill the chain of every mode whose provider is registered. */
async function fillModeModels(deps: OnboardingDeps): Promise<void> {
  const registered = await deps.availableModels().catch(() => [] as Array<{ provider: string; model: string }>);
  const providers = new Set(registered.map((m) => m.provider));
  for (const mode of ['fast', 'thinking']) {
    const provider = deps.modeProvider(mode);
    if (!provider || !providers.has(provider)) { continue; }
    if (deps.activeModels().length) { continue; } // the user configured it
    await deps.setModeModels(mode, deps.defaultModels(mode));
  }
}

/** The key prompt for one provider, with the hint of what the key looks like. */
export async function askForProviderKey(preset: ProviderPreset): Promise<string | undefined> {
  const box = vscode.window.createInputBox();
  box.title = `${preset.label} API key`;
  box.prompt = `Paste your ${preset.label} key (${preset.keyHint}). It is stored in VS Code’s secret storage. Get one at ${preset.keyUrl}`;
  box.placeholder = preset.keyHint;
  box.password = true;
  box.ignoreFocusOut = true;
  const value = await new Promise<string | undefined>((resolve) => {
    const subscriptions = [
      box.onDidAccept(() => {
        subscriptions.forEach((s) => s.dispose());
        resolve(box.value.trim() || undefined);
        box.hide();
      }),
      box.onDidHide(() => {
        subscriptions.forEach((s) => s.dispose());
        resolve(undefined);
      }),
    ];
    box.show();
  });
  box.dispose();
  return value;
}

/** The providers the user has a key for. */
export async function configuredProviders(secrets: vscode.SecretStorage): Promise<string[]> {
  const out: string[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (await secrets.get(preset.secretKey)) { out.push(preset.id); }
  }
  return out;
}
