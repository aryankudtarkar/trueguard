#!/usr/bin/env node
// design-lint: fails the build on visual rules that break native-first design.
// - hex or rgb color literals in source and webview
// - px font sizes in the webview
// - emoji used as icons (the design uses codicons only)
// - buttons without an accessible name
// - animations without a reduced-motion guard

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'webview'];
// A CSS color literal is #RGB, #RGBA, #RRGGBB or #RRGGBBAA — exactly 3, 4, 6
// or 8 hex digits. A GitHub issue reference (#713) must not trip the lint.
const colorRe = /(?:#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b)|(?:\brgba?\s*\()/;
const pxFontRe = /font-size\s*:\s*\d+px/;
// Emoji ranges: the UI uses codicons, not emoji.
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const buttonRe = /createElement\('button'\)/;

let failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(ts|mjs|css)$/.test(entry)) { continue; }
    const text = readFileSync(p, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // A color mentioned in a comment is not a style: issue references like
      // "#713" are not colors.
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
      if (colorRe.test(line) && !isComment) {
        failures.push(`${p}:${i + 1}: color literal — use --vscode-* variables or ThemeColor`);
      }
      if (pxFontRe.test(line)) {
        failures.push(`${p}:${i + 1}: px font-size — inherit --vscode-font-size`);
      }
      if (entry !== 'main.ts' && emojiRe.test(line)) {
        failures.push(`${p}:${i + 1}: emoji used as an icon — use a codicon or a word`);
      }
    });

    if (entry.endsWith('.css')) {
      // Every animation must have a reduced-motion guard.
      if (/(^|[;\s])(transition|animation)\s*:/.test(text) && !text.includes('prefers-reduced-motion')) {
        failures.push(`${p}: animations without a prefers-reduced-motion guard`);
      }
    }

    if (entry.endsWith('.ts') && p.startsWith('webview')) {
      // A button needs an accessible name.
      lines.forEach((line, i) => {
        if (!buttonRe.test(line)) { return; }
        const window = lines.slice(i, i + 14).join('\n');
        if (!/aria-label|ariaLabelledBy|title\s*=/.test(window)) {
          failures.push(`${p}:${i + 1}: button without an accessible name (aria-label)`);
        }
      });
    }
  }
}

for (const root of roots) {
  walk(root);
}

if (failures.length) {
  console.error('design-lint failed:');
  for (const f of failures) { console.error('  ' + f); }
  process.exit(1);
}
console.log('design-lint passed');
