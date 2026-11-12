import { describe, expect, it } from 'vitest';
import { findFilesForMention, parseMentions, resolveMentions, stripMentions } from '../../src/context/mentions';

const FILES = [
  'src/app.ts',
  'src/util/format.ts',
  'src/components/Button.tsx',
  'docs/README.md',
  'package.json',
];

describe('mentions', () => {
  it('finds a file mention', () => {
    const mentions = parseMentions('please look at @src/app.ts and fix it');
    expect(mentions.length).toBe(1);
    expect(mentions[0]?.value).toBe('src/app.ts');
    expect(mentions[0]?.kind).toBe('file');
  });

  it('finds several mentions', () => {
    const mentions = parseMentions('@src/app.ts and @package.json');
    expect(mentions.map((m) => m.value)).toEqual(['src/app.ts', 'package.json']);
  });

  it('ignores a bare @ and an email address', () => {
    expect(parseMentions('hello @ world')).toEqual([]);
    expect(parseMentions('write to me@example.com')).toEqual([]);
  });

  it('strips the mentions from the text', () => {
    expect(stripMentions('look at @src/app.ts please')).toBe('look at please');
  });

  it('resolves a mention to a workspace file', () => {
    expect(resolveMentions(FILES, parseMentions('@src/app.ts'))).toEqual(['src/app.ts']);
  });

  it('resolves a partial path to the best match', () => {
    expect(findFilesForMention(FILES, 'app.ts')[0]).toBe('src/app.ts');
    expect(findFilesForMention(FILES, 'format')[0]).toBe('src/util/format.ts');
  });

  it('returns nothing for a mention that matches no file', () => {
    expect(resolveMentions(FILES, parseMentions('@nonexistent/thing.ts'))).toEqual([]);
  });

  it('lists the candidates for an empty query', () => {
    expect(findFilesForMention(FILES, '', 3).length).toBe(3);
  });
});
