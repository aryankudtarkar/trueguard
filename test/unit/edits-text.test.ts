import { describe, expect, it } from 'vitest';
import {
  BOM,
  detectEol,
  materialize,
  profileText,
  stripBom,
  toEditableText,
  toLf,
} from '../../src/edits/text';

describe('text normalization', () => {
  it('detects the EOL style', () => {
    expect(detectEol('a\nb\n').eol).toBe('\n');
    expect(detectEol('a\r\nb\r\n').eol).toBe('\r\n');
    expect(detectEol('a\rb\r').eol).toBe('\r');
    expect(detectEol('no line breaks').eol).toBe('\n');
  });

  it('flags mixed EOL styles', () => {
    expect(detectEol('a\r\nb\nc').mixed).toBe(true);
    expect(detectEol('a\r\nb\r\n').mixed).toBe(false);
  });

  it('strips a BOM and keeps it out of the editable text', () => {
    expect(stripBom(`${BOM}hello`)).toBe('hello');
    expect(toEditableText(`${BOM}hello\n`).text).toBe('hello\n');
    expect(profileText(`${BOM}hello\n`).bom).toBe(true);
  });

  it('normalizes every EOL style to LF', () => {
    expect(toLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('restores BOM, EOL and the trailing newline', () => {
    const raw = `${BOM}one\r\ntwo\r\n`;
    const { text, profile } = toEditableText(raw);
    expect(text).toBe('one\ntwo\n');
    const written = materialize('one\ntwo\nthree\n', profile);
    expect(written).toBe(`${BOM}one\r\ntwo\r\nthree\r\n`);
  });

  it('keeps a file without a trailing newline free of one', () => {
    const { text, profile } = toEditableText('one\ntwo');
    expect(text).toBe('one\ntwo');
    expect(profile.trailingNewline).toBe(false);
    expect(materialize('one\ntwo\n', profile)).toBe('one\ntwo');
  });

  it('round-trips an unchanged file exactly', () => {
    for (const raw of ['a\n', 'a\r\nb\r\n', 'a', `${BOM}x\r\n`, 'x\ry\r']) {
      const { text, profile } = toEditableText(raw);
      expect(materialize(text, profile)).toBe(raw);
    }
  });
});
