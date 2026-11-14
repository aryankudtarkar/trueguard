
/**
 * Byte-capped JSON payloads (FR-9).
 *
 * A tool result must stay parseable by the agent: cutting a serialized JSON
 * document at a byte offset can split an escape sequence and produce invalid
 * JSON. So instead of slicing the text, we shrink the VALUE: the longest
 * string inside it is elided head/tail (repeatedly) until the payload fits.
 * The structure (path, counts, hashes) survives; only the bulky body shrinks.
 */

export interface CappedJson {
  /** Serialized JSON, guaranteed to parse (unless the value cannot shrink). */
  text: string;
  /** True when something had to be elided. */
  truncated: boolean;
}

type Path = Array<string | number>;

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Longest string in the structure, with the path to it. */
function findLongestString(value: unknown, path: Path): { path: Path; text: string } | undefined {
  if (typeof value === 'string') { return { path, text: value }; }
  if (Array.isArray(value)) {
    let best: { path: Path; text: string } | undefined;
    for (let i = 0; i < value.length; i++) {
      const found = findLongestString(value[i], [...path, i]);
      if (found && (!best || found.text.length > best.text.length)) { best = found; }
    }
    return best;
  }
  if (value && typeof value === 'object') {
    let best: { path: Path; text: string } | undefined;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = findLongestString(child, [...path, key]);
      if (found && (!best || found.text.length > best.text.length)) { best = found; }
    }
    return best;
  }
  return undefined;
}

/** Longest array in the structure, with the path to it. */
function findLongestArray(value: unknown, path: Path): { path: Path; value: unknown[] } | undefined {
  if (Array.isArray(value)) {
    let best: { path: Path; value: unknown[] } | undefined;
    for (let i = 0; i < value.length; i++) {
      const found = findLongestArray(value[i], [...path, i]);
      if (found && (!best || found.value.length > best.value.length)) { best = found; }
    }
    if (!best || value.length > best.value.length) { return { path, value }; }
    return best;
  }
  if (value && typeof value === 'object') {
    let best: { path: Path; value: unknown[] } | undefined;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = findLongestArray(child, [...path, key]);
      if (found && (!best || found.value.length > best.value.length)) { best = found; }
    }
    return best;
  }
  return undefined;
}

/** Immutably replace the value at `path`. */
function setAtPath(root: unknown, path: Path, next: unknown): unknown {
  if (path.length === 0) { return next; }
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAtPath(copy[head as number], rest, next);
    return copy;
  }
  const obj = { ...(root as Record<string, unknown>) };
  obj[head as string] = setAtPath(obj[head as string], rest, next);
  return obj;
}

/** Head/tail elision of a single string, with a short inline marker. */
export function elideString(text: string, keepChars: number): string {
  if (text.length <= keepChars) { return text; }
  const headLen = Math.floor(keepChars * 0.7);
  const tailLen = Math.max(0, keepChars - headLen);
  const omitted = text.length - headLen - tailLen;
  return `${text.slice(0, headLen)}\n…[${omitted} chars elided]…\n${tailLen > 0 ? text.slice(-tailLen) : ''}`;
}

/**
 * Fit a value under a byte cap and return it as JSON text.
 * Strings are elided first, then arrays are halved, until the payload fits.
 */
export function capJson(value: unknown, maxBytes: number): CappedJson {
  let current = value;
  let truncated = false;

  for (let attempt = 0; attempt < 12; attempt++) {
    const text = serialize(current);
    if (byteLength(text) <= maxBytes) { return { text, truncated }; }

    const longest = findLongestString(current, []);
    if (longest && longest.text.length > 64) {
      const keep = Math.max(32, Math.floor(longest.text.length / 2));
      current = setAtPath(current, longest.path, elideString(longest.text, keep));
      truncated = true;
      continue;
    }

    const longestArray = findLongestArray(current, []);
    if (longestArray && longestArray.value.length > 1) {
      const half = Math.max(1, Math.floor(longestArray.value.length / 2));
      current = setAtPath(current, longestArray.path, longestArray.value.slice(0, half));
      truncated = true;
      continue;
    }
    break;
  }

  const text = serialize(current);
  if (byteLength(text) <= maxBytes) { return { text, truncated }; }
  return {
    text: JSON.stringify({
      error: 'output_too_large',
      message:
        `The result was ${byteLength(text)} bytes, over the ${maxBytes} byte cap. ` +
        'Narrow the request (startLine/endLine, glob, maxResults) to see less at once.',
      bytes: byteLength(text),
    }),
    truncated: true,
  };
}
