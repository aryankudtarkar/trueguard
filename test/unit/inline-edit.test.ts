import { describe, expect, it } from 'vitest';
import { buildInlinePrompt, type InlineSelection } from '../../src/ui/inlineEdit';

describe('the inline edit prompt', () => {
  const selection: InlineSelection = {
    path: '/ws/src/app.ts',
    relativePath: 'src/app.ts',
    startLine: 10,
    endLine: 14,
    text: 'const a = 1;',
  };

  it('names the file, the lines and the instruction', () => {
    const prompt = buildInlinePrompt(selection, 'make this a loop');
    expect(prompt).toContain('make this a loop');
    expect(prompt).toContain('lines 10-14');
    expect(prompt).toContain('app.ts');
    expect(prompt).toContain('propose_edit');
  });

  it('says "line" for a single line', () => {
    const prompt = buildInlinePrompt({ ...selection, endLine: 10 }, 'fix it');
    expect(prompt).toContain('line 10');
    expect(prompt).not.toContain('lines 10-14');
  });

  it('asks for the smallest change', () => {
    const prompt = buildInlinePrompt(selection, 'fix it');
    expect(prompt).toContain('small');
  });
});
