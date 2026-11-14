/**
 * The two modes and their providers (FR-2, and the brief's "model setup").
 *
 * TrueGuard never calls a provider itself: it registers the providers in
 * TrueForge and then refers to the models by their TrueForge name
 * (`provider/model`). The keys live in the extension's SecretStorage and in
 * TrueForge's own settings — never in the repository, never in a log.
 */

/** The modes the user can pick. */
export type ModeId = 'fast' | 'thinking';

export interface ModeDefinition {
  id: ModeId;
  /** The name shown in the UI. */
  label: string;
  /** One line, plain words (PRD 6.8). */
  description: string;
  /** The model used when the mode's list is empty. */
  defaultModel: string;
  /** The reasoning effort sent with the model, when the model supports it. */
  reasoningEffort?: string;
}

export const MODES: readonly ModeDefinition[] = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'Quick answers for everyday work.',
    defaultModel: 'groq/gpt-oss-120b',
  },
  {
    id: 'thinking',
    label: 'Thinking',
    description: 'Slower and deeper: use it for the hard problems.',
    defaultModel: 'nvidia/deepseek-ai/deepseek-v4.1-flash',
    reasoningEffort: 'medium',
  },
];

export function modeById(id: string): ModeDefinition | undefined {
  return MODES.find((m) => m.id === id);
}

/** A model the mode can use. */
export interface ProviderModel {
  /** The identifier sent to the provider. */
  modelId: string;
  /** The name shown to the user. */
  label: string;
  contextLength: number;
  maxOutputTokens: number;
  /** The reasoning efforts the model supports, if any. */
  reasoningEfforts?: string[];
}

export interface ProviderPreset {
  /** The provider name in TrueForge (`provider/model`). */
  id: string;
  label: string;
  /** The provider's OpenAI-compatible base URL. */
  baseUrl: string;
  /** The models this provider offers. */
  models: ProviderModel[];
  /** The SecretStorage key the API key is stored under. */
  secretKey: string;
  /** What the key looks like, for the prompt. */
  keyHint: string;
  /** Where the user gets the key. */
  keyUrl: string;
}

/** The providers TrueGuard knows how to set up. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    secretKey: 'trueguard.provider.groq.apiKey',
    models: [
      {
        modelId: 'gpt-oss-120b',
        label: 'GPT-OSS 120B',
        contextLength: 131_072,
        maxOutputTokens: 32_768,
        reasoningEfforts: ['none', 'low', 'medium', 'high'],
      },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyHint: 'nvapi-…',
    keyUrl: 'https://build.nvidia.com',
    secretKey: 'trueguard.provider.nvidia.apiKey',
    models: [
      {
        modelId: 'deepseek-ai/deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash',
        contextLength: 131_072,
        maxOutputTokens: 32_768,
        reasoningEfforts: ['none', 'low', 'medium', 'high'],
      },
    ],
  },
];

/** The manifest TrueForge expects for a provider (verified: the OpenAPI). */
export function manifestFor(preset: ProviderPreset, apiKey: string): Record<string, unknown> {
  return {
    type: 'custom',
    name: preset.id,
    base_url: preset.baseUrl,
    auth: { api_key: apiKey },
    models: preset.models.map((model) => ({
      model_id: model.modelId,
      name: model.modelId,
      properties: {
        context_length: model.contextLength,
        max_output_tokens: model.maxOutputTokens,
        ...(model.reasoningEfforts ? { reasoning_efforts: model.reasoningEfforts } : {}),
      },
    })),
  };
}

/** The model profiles a mode starts with (the failover chain of that mode). */
export function defaultModelsFor(mode: ModeDefinition): Array<{ id: string; label: string; ref: string }> {
  const preset = PROVIDER_PRESETS.find((p) => mode.defaultModel.startsWith(`${p.id}/`));
  const modelId = mode.defaultModel.slice(preset ? preset.id.length + 1 : 0);
  const model = preset?.models.find((m) => m.modelId === modelId);
  return [
    {
      id: mode.id,
      label: `${mode.label} · ${model?.label ?? modelId}`,
      ref: mode.defaultModel,
    },
  ];
}
