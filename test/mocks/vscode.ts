// Minimal vscode mock for unit tests. Only what imported modules actually use.
export const window = {
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
};

export const workspace = {
  getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
};

export const commands = {};
export const ThemeColor = class {};
