// Minimal vscode mock for unit tests. Only what imported modules actually use.
export const window = {
  /** The answer the next showWarningMessage call resolves with. */
  warningAnswer: undefined as string | undefined,
  showWarningMessage: async () => window.warningAnswer,
  /** The answer the next showInformationMessage call resolves with. */
  informationAnswer: undefined as string | undefined,
  showInformationMessage: async () => window.informationAnswer,
  showErrorMessage: async () => undefined,
  createOutputChannel: () => ({
    appendLine: () => undefined,
    append: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
  activeEditorListeners: [] as Array<(editor: unknown) => void>,
  // Test hook: dispatch an active-editor change to subscribers
  fireActiveEditor(editor: unknown): void {
    for (const l of [...window.activeEditorListeners]) { l(editor); }
  },
  onDidChangeActiveTextEditor(listener: (editor: unknown) => void): { dispose(): void } {
    window.activeEditorListeners.push(listener);
    return { dispose: () => { window.activeEditorListeners = window.activeEditorListeners.filter((l) => l !== listener); } };
  },
};

export class EventEmitter<T> {
  private listeners: Array<(v: T) => void> = [];
  readonly event = (listener: (v: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(value: T): void {
    for (const l of [...this.listeners]) { l(value); }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export const workspace = {
  /** The path relative to the workspace folder (a test stand-in). */
  asRelativePath: (p: string) => p.replace(/^.*?\/(?=src\/)/, ''),
  // Optional per-test overrides keyed "section.key"; missing keys fall through
  // to the provided default.
  configOverrides: new Map<string, unknown>(),
  getConfiguration(section?: string): { get(key: string, d: unknown): unknown } {
    return {
      get: (key: string, d: unknown) => {
        const full = section ? `${section}.${key}` : key;
        return workspace.configOverrides.get(full) ?? d;
      },
    };
  },
};

export const Uri = {
  file(p: string): { fsPath: string; toString(): string } {
    return { fsPath: p, toString: () => `file://${p}` };
  },
  joinPath(uri: { fsPath: string; toString(): string }, ...parts: string[]): { fsPath: string; toString(): string } {
    const fsPath = [uri.fsPath, ...parts.map(String)].join('/');
    return { fsPath, toString: () => `${uri.toString()}/${parts.join('/')}` };
  },
};

export const commands = {};
export const ThemeColor = class {};
