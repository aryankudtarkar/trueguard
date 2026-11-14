/**
 * Output cap utility (FR-9): over-cap tool results are elided head and tail
 * with a marker telling the agent how to request a narrower range.
 *
 * The cap is expressed in BYTES (UTF-8), because that is what the setting
 * `trueguard.toolOutputCapBytes` means and what the agent actually pays for.
 * Cuts always land on character boundaries, so no replacement characters are
 * produced.
 */

export interface TruncationResult {
  text: string;
  truncated: boolean;
}

export const DEFAULT_MAX_BYTES = 16_384;

/** Head share of the budget when eliding (the rest goes to the tail). */
const HEAD_SHARE = 0.7;

/** Longest prefix of `buf` that is at most `maxBytes` bytes and ends on a
 *  UTF-8 character boundary. */
function headBytes(buf: Buffer, maxBytes: number): number {
  let end = Math.min(maxBytes, buf.length);
  // Walk back while the byte at `end` is a UTF-8 continuation byte (0b10xxxxxx):
  // that would cut a multi-byte character in half.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) { end--; }
  return end;
}

/** Longest suffix of `buf` that is at most `maxBytes` bytes and starts on a
 *  UTF-8 character boundary. */
function tailBytes(buf: Buffer, maxBytes: number): number {
  let start = Math.max(0, buf.length - maxBytes);
  // Move forward off a continuation byte until a lead byte is reached.
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) { start++; }
  return buf.length - start;
}

export function truncateMiddle(text: string, maxBytes: number = DEFAULT_MAX_BYTES): TruncationResult {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  const markerOverhead = 220; // keep room for the marker line itself
  const budget = Math.max(0, maxBytes - markerOverhead);
  const headBudget = Math.floor(budget * HEAD_SHARE);
  const tailBudget = Math.max(0, budget - headBudget);

  const headLen = headBytes(buf, headBudget);
  const tailLen = tailBytes(buf, tailBudget);
  const head = buf.subarray(0, headLen).toString('utf8');
  const tail = tailLen > 0 ? buf.subarray(buf.length - tailLen).toString('utf8') : '';
  const marker =
    `\n[TrueGuard: output truncated — total ${buf.length} bytes, showing first ${headLen}` +
    ` and last ${tailLen}. Narrow the request (startLine/endLine, glob, maxResults) to see more.]\n`;
  return { text: `${head}${marker}${tail}`, truncated: true };
}
