import { describe, expect, it } from 'vitest';
import { filterByGlob, globToRegExp } from '../../src/mcp/vscodeTools';

describe('glob matching for list_files', () => {
  const files = [
    'src/app.ts',
    'src/nested/deep.ts',
    'src/nested/data.json',
    'README.md',
    'docs/guide.md',
  ];

  it('matches everything when no glob is given', () => {
    expect(filterByGlob(files, undefined).length).toBe(files.length);
  });

  it('matches a prefix glob', () => {
    expect(filterByGlob(files, 'src/**')).toEqual(['src/app.ts', 'src/nested/deep.ts', 'src/nested/data.json']);
  });

  it('matches a suffix glob across directories', () => {
    expect(filterByGlob(files, '**/*.ts')).toEqual(['src/app.ts', 'src/nested/deep.ts']);
  });

  it('matches a single directory level only', () => {
    expect(filterByGlob(files, '*.md')).toEqual(['README.md']);
  });

  it('matches a nested path exactly', () => {
    expect(filterByGlob(files, 'src/nested/*.json')).toEqual(['src/nested/data.json']);
  });

  it('does not match across directories for a bare pattern', () => {
    expect(globToRegExp('*.ts').test('src/app.ts')).toBe(false);
    expect(globToRegExp('**/*.ts').test('src/app.ts')).toBe(true);
  });

  it('treats dots literally', () => {
    expect(globToRegExp('src/app.ts').test('src/appXts')).toBe(false);
    expect(globToRegExp('src/app.ts').test('src/app.ts')).toBe(true);
  });
});
