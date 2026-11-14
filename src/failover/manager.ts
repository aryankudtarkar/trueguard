import {
  BREAKER_COOLDOWN_MS,
  classifyError,
  shouldFailover,
  type ClassifiedError,
  type ErrorInput,
} from './classifier';

/**
 * Failover manager (Phase 6.2).
 *
 * Rules from FR-7:
 *  - the models are an ordered list; index 0 is the primary,
 *  - at most ONE attempt per model per turn,
 *  - a 429 waits for Retry-After (capped at 5 s) and then switches,
 *  - a model that failed is unhealthy for 60 s; after that a probe may send
 *    traffic back to the primary,
 *  - the user is told once, calmly.
 */

export interface ModelProfile {
  id: string;
  label: string;
  /** The model identifier TrueForge expects (provider/model). */
  ref: string;
}

export interface FailoverOptions {
  /** Injected clock (milliseconds). */
  now?: () => number;
  /** Injected sleep, so the tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Failover off: a provider failure ends the turn. */
  enabled?: boolean;
  /** How long a failed model stays out (default 60 s). */
  cooldownMs?: number;
}

export interface FailoverDecision {
  /** What to do next. */
  action: 'retry' | 'giveup';
  /** The model to use for the next attempt. */
  model?: ModelProfile;
  /** How long to wait first. */
  delayMs: number;
  /** The classification that led here. */
  classified: ClassifiedError;
  /** The message shown to the user (once). */
  notice?: string;
}

export class FailoverManager {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Failover off: a provider failure ends the turn. */
  private enabled: boolean;
  /** How long a failed model stays out. */
  private cooldownMs: number;
  /** Model id → when it becomes healthy again (0 = healthy). */
  private readonly unhealthyUntil = new Map<string, number>();
  /** Model id → attempts in the current turn. */
  private readonly attempts = new Map<string, number>();
  private activeIndex = 0;

  constructor(
    private models: readonly ModelProfile[],
    options: FailoverOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.enabled = options.enabled ?? true;
    this.cooldownMs = options.cooldownMs ?? BREAKER_COOLDOWN_MS;
  }

  /** Is failover enabled? (the user can turn it off) */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Apply the user's failover settings at runtime. */
  setPolicy(policy: { enabled?: boolean; cooldownMs?: number }): void {
    if (policy.enabled !== undefined) { this.enabled = policy.enabled; }
    if (policy.cooldownMs !== undefined) { this.cooldownMs = policy.cooldownMs; }
  }

  /** The models, in order. */
  get profiles(): readonly ModelProfile[] {
    return this.models;
  }

  /** The model the next turn uses. */
  get active(): ModelProfile | undefined {
    return this.models[this.activeIndex];
  }

  /** The index of the active model. */
  get index(): number {
    return this.activeIndex;
  }

  /** Models that are currently marked unhealthy (for the UI). */
  get unhealthy(): ModelProfile[] {
    const now = this.now();
    return this.models.filter((m) => (this.unhealthyUntil.get(m.id) ?? 0) > now);
  }

  /** Replace the model list (the user edited the settings). */
  setModels(models: readonly ModelProfile[]): void {
    this.models = models;
    if (this.activeIndex >= models.length) { this.activeIndex = 0; }
  }

  /** Switch to a specific model (the Switch Model QuickPick). */
  useModel(index: number): void {
    if (index < 0 || index >= this.models.length) { return; }
    this.activeIndex = index;
  }

  /** Start a new turn: the per-turn attempt budget is reset. */
  onTurnStart(): void {
    this.attempts.clear();
  }

  /** A model succeeded: it is healthy again, and the breaker resets. */
  noteSuccess(modelId?: string): void {
    const id = modelId ?? this.active?.id;
    if (!id) { return; }
    this.unhealthyUntil.delete(id);
    // A success on a fallback means the primary is worth probing again.
    if (id !== this.models[0]?.id) { this.activeIndex = 0; }
  }

  /** Classify a failure (exposed for the tests and the UI). */
  classify(input: ErrorInput): ClassifiedError {
    return classifyError(input);
  }

  /**
   * Decide what to do after a failure: retry on the next model, or give up.
   */
  async handleFailure(input: ErrorInput): Promise<FailoverDecision> {
    const classified = classifyError(input);

    if (!this.enabled || !shouldFailover(classified)) {
      return { action: 'giveup', delayMs: 0, classified };
    }

    const current = this.active;
    if (current) {
      this.attempts.set(current.id, (this.attempts.get(current.id) ?? 0) + 1);
      this.unhealthyUntil.set(current.id, this.now() + this.cooldownMs);
    }

    const next = this.nextModel();
    if (!next) {
      return {
        action: 'giveup',
        delayMs: 0,
        classified,
        notice: 'No model is available right now. Retry, or edit your model list.',
      };
    }

    const delayMs = Math.min(classified.retryAfterMs ?? 0, 5_000);
    if (delayMs > 0) { await this.sleep(delayMs); }

    this.activeIndex = next.index;
    const notice = current
      ? `Switched to ${next.model.label} because ${current.label} is ${classified.short}.`
      : `Switched to ${next.model.label}.`;
    return { action: 'retry', model: next.model, delayMs, classified, notice };
  }

  /** The next model to try: healthy, not yet tried in this turn. */
  private nextModel(): { index: number; model: ModelProfile } | undefined {
    const now = this.now();
    const count = this.models.length;
    for (let step = 1; step <= count; step++) {
      const index = (this.activeIndex + step) % count;
      const model = this.models[index];
      if (!model) { continue; }
      // One attempt per model per turn.
      if ((this.attempts.get(model.id) ?? 0) > 0) { continue; }
      // The breaker: an unhealthy model is skipped until it cools down.
      if ((this.unhealthyUntil.get(model.id) ?? 0) > now) { continue; }
      return { index, model };
    }
    return undefined;
  }

  /** Is this model healthy right now? */
  isHealthy(modelId: string): boolean {
    return (this.unhealthyUntil.get(modelId) ?? 0) <= this.now();
  }
}

