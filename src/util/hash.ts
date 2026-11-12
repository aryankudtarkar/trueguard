import { createHash } from 'node:crypto';

/** sha256 of text with EOL normalized to LF — the canonical content hash. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
