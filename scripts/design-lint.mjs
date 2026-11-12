#!/usr/bin/env node
// design-lint: fails the build on visual rules that break native-first design.
// - hex or rgb color literals in source and webview
// - px font sizes in the webview
// Phase 7 will extend this with codicon, aria-label and reduced-motion checks.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'webview'];
const colorRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/;
const pxFontRe = /font-size\s*:\s*\d+px/;

let failures = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|mjs|css)$/.test(entry)) {
      const text = readFileSync(p, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (colorRe.test(line)) failures.push(`${p}:${i + 1}: color literal — use --vscode-* variables or ThemeColor`);
        if (pxFontRe.test(line)) failures.push(`${p}:${i + 1}: px font-size — inherit --vscode-font-size`);
      });
    }
  }
}
for (const root of roots) walk(root);

if (failures.length) {
  console.error('design-lint failed:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('design-lint passed');
