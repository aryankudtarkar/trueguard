import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../src/ui/doctor';

/**
 * The setup doctor: one command that says what is ready and what to do about
 * what is not. Every broken check carries the action that fixes it.
 */

describe('the setup doctor', () => {
  it('reports everything as ready when it is', async () => {
    const checks = await runDoctor({
      serverUp: async () => true,
      models: async () => [{ provider: 'groq', model: 'gpt-oss-120b' }],
      editorServerUp: () => true,
      connectorRegistered: async () => true,
      activeModels: () => [{ label: 'Fast', ref: 'groq/gpt-oss-120b' }],
    });
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.length).toBe(5);
  });

  it('offers the fix for a server that is down', async () => {
    const checks = await runDoctor({
      serverUp: async () => false,
      models: async () => [],
      editorServerUp: () => true,
      connectorRegistered: async () => false,
      activeModels: () => [],
    });
    const server = checks.find((c) => c.name === 'TrueForge server');
    expect(server?.ok).toBe(false);
    expect(server?.fix?.command).toBe('trueguard.startTrueForge');
  });

  it('offers the fix for missing models', async () => {
    const checks = await runDoctor({
      serverUp: async () => true,
      models: async () => [],
      editorServerUp: () => true,
      connectorRegistered: async () => true,
      activeModels: () => [],
    });
    const models = checks.find((c) => c.name === 'Models');
    expect(models?.ok).toBe(false);
    expect(models?.fix?.command).toBe('trueguard.configureProviders');
  });

  it('offers a reload when the connector is missing', async () => {
    const checks = await runDoctor({
      serverUp: async () => true,
      models: async () => [{ provider: 'groq', model: 'gpt-oss-120b' }],
      editorServerUp: () => true,
      connectorRegistered: async () => false,
      activeModels: () => [{ label: 'Fast', ref: 'groq/gpt-oss-120b' }],
    });
    const connector = checks.find((c) => c.name === 'Connector in TrueForge');
    expect(connector?.ok).toBe(false);
    expect(connector?.fix?.command).toBe('workbench.action.reloadWindow');
  });

  it('names the models it found', async () => {
    const checks = await runDoctor({
      serverUp: async () => true,
      models: async () => [{ provider: 'groq', model: 'gpt-oss-120b' }],
      editorServerUp: () => true,
      connectorRegistered: async () => true,
      activeModels: () => [{ label: 'Fast', ref: 'groq/gpt-oss-120b' }],
    });
    expect(checks.find((c) => c.name === 'Models')?.detail).toContain('groq/gpt-oss-120b');
    expect(checks.find((c) => c.name === 'Active mode')?.detail).toContain('groq/gpt-oss-120b');
  });
});
