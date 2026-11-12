import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** The webview loads its stylesheet next to the bundled script. */
function copyWebviewAssets() {
  mkdirSync('out/webview', { recursive: true });
  copyFileSync('webview/styles.css', 'out/webview/styles.css');
}

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  target: 'node22',
  platform: 'node',
  outfile: 'out/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome105',
  platform: 'browser',
  outfile: 'out/webview/main.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const ctxExt = await esbuild.context(extensionOptions);
  const ctxWeb = await esbuild.context(webviewOptions);
  await ctxExt.watch();
  await ctxWeb.watch();
  copyWebviewAssets();
} else {
  await esbuild.build(extensionOptions);
  await esbuild.build(webviewOptions);
  copyWebviewAssets();
}
