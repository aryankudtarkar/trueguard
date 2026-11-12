import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'webview/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.mjs', 'spikes/**/*.mjs', 'tools/**/*.mjs', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // Integration tests log inside the VS Code extension host; console is the only channel.
    files: ['test/integration/**/*.ts', 'test/mocks/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
