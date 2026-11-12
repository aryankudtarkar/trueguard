/**
 * Minimal type declarations for the `diff` package (jsdiff), which ships no
 * types of its own. Only the API this extension uses is declared.
 */
declare module 'diff' {
  export interface Change<T> {
    value: T[];
    added?: boolean;
    removed?: boolean;
    count?: number;
  }

  export function diffArrays<T>(
    oldArr: T[],
    newArr: T[],
    options?: { comparator?: (a: T, b: T) => number },
  ): Change<T>[];

  export function diffLines(oldStr: string, newStr: string, options?: unknown): Change<string>[];
}
