import * as vscode from 'vscode';
import { logger, redact } from '../util/logger';
import type { TrueForgeClient } from '../trueforge/client';
import { PROVIDER_PRESETS, manifestFor, type ProviderPreset } from './presets';

/**
 * Provider onboarding.
 *
 * The user gives their API keys once (during onboarding), the keys go into
 * SecretStorage, and the providers are registered in TrueForge. TrueGuard
 * never calls the providers itself: it only tells TrueForge which models
 * exist.
 *
 * The command can be run again at any time to change a key.
 */

export interface ConfigureProvidersDeps {
  client: TrueForgeClient;
  secrets: vscode.SecretStorage;
  /** Ask the user for a key (injectable for the tests). */
  askForKey?: (preset: ProviderPreset) => Promise<string | undefined>;
  /** Say something to the user. */
  report?: (message: string) => void;
}

export interface ConfigureProvidersResult {
  /** The providers that were registered. */
  registered: string[];
  /** The providers whose key was missing. */
  skipped: string[];
  /** The providers that failed. */
  failed: string[];
}

/** Ask for a key without showing it. */
async function defaultAskForKey(preset: ProviderPreset): Promise<string | undefined> {
  const box = vscode.window.createInputBox();
  box.title = `TrueGuard: ${preset.label} API key`;
  box.prompt = `Paste your ${preset.label} key (${preset.keyHint}). It is stored in the extension's secret storage, never in your settings or your repository. Get one at ${preset.keyUrl}`;
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

/**
 * Register the providers in TrueForge, asking for the keys that are missing.
 */
export async function configureProviders(deps: ConfigureProvidersDeps): Promise<ConfigureProvidersResult> {
  const ask = deps.askForKey ?? defaultAskForKey;
  const report = deps.report ?? ((message: string) => void vscode.window.showInformationMessage(message));
  const result: ConfigureProvidersResult = { registered: [], skipped: [], failed: [] };

  for (const preset of PROVIDER_PRESETS) {
    let key = await deps.secrets.get(preset.secretKey);
    if (!key) {
      const entered = await ask(preset);
      if (!entered) {
        result.skipped.push(preset.id);
        continue;
      }
      key = entered;
      await deps.secrets.store(preset.secretKey, key);
    }
    try {
      await deps.client.upsertModelProvider(manifestFor(preset, key));
      result.registered.push(preset.id);
      logger().info(`provider registered: ${preset.id}`);
    } catch (e) {
      result.failed.push(preset.id);
      logger().warn(`provider registration failed for ${preset.id}: ${redact(String(e))}`);
    }
  }

  if (result.registered.length) {
    report(
      `Registered ${result.registered.length} provider${result.registered.length === 1 ? '' : 's'} in TrueForge: ${result.registered.join(', ')}.`,
    );
  }
  if (result.failed.length) {
    void vscode.window.showErrorMessage(
      `TrueGuard could not register: ${result.failed.join(', ')}. Check the key and try again.`,
    );
  }
  if (result.skipped.length && !result.registered.length) {
    report('No provider was registered. You can run "TrueGuard: Configure Providers" again at any time.');
  }
  return result;
}
