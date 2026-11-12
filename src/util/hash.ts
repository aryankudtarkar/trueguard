import { createHash } from 'node:crypto';

/**
 * sha256 of text with EOL normalized to LF — the canonical content hash.
 * A UTF-8 BOM is ignored too: the hash identifies the TEXT, not the encoding,
 * and the same file must hash the same whether it is read from disk or from
 * an editor buffer.
 */
export function contentHash(text: string): string {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
