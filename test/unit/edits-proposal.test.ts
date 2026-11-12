import { describe, expect, it } from 'vitest';
import { buildProposal, type ProposalContext } from '../../src/edits/proposal';

const FILES: Record<string, string> = {
  'src/app.ts': 'export const a = 1;\nexport const b = 2;\nexport const a = 1;\n',
  'src/other.ts': 'one\ntwo\n',
};

const ctx: ProposalContext = {
  async readFile(path: string): Promise<string | undefined> {
    return FILES[path];
  },
  async exists(path: string): Promise<boolean> {
    return path in FILES;
  },
};

describe('proposal builder', () => {
  it('builds hunks for a modify', async () => {
    const res = await buildProposal(
      [{ path: 'src/other.ts', kind: 'modify', edits: [{ oldText: 'two', newText: 'TWO' }] }],
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.files.length).toBe(1);
    expect(res.files[0]?.hunks.length).toBe(1);
    expect(res.files[0]?.proposedText).toContain('TWO');
  });

  it('refuses a whole-file rewrite', async () => {
    const res = await buildProposal(
      [{ path: 'src/other.ts', kind: 'modify', edits: [{ oldText: FILES['src/other.ts']!, newText: 'x\n' }] }],
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('whole_file_rewrite');
  });

  it('refuses an ambiguous oldText and reports the candidate lines', async () => {
    const res = await buildProposal(
      [{ path: 'src/app.ts', kind: 'modify', edits: [{ oldText: 'export const a = 1;', newText: 'x' }] }],
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('multiple_matches');
    expect(res.errors[0]?.candidates?.length).toBe(2);
  });

  it('refuses a missing file for modify and an existing file for create', async () => {
    const missing = await buildProposal(
      [{ path: 'src/nope.ts', kind: 'modify', edits: [{ oldText: 'a', newText: 'b' }] }],
      ctx,
    );
    expect(missing.errors[0]?.code).toBe('does_not_exist');

    const exists = await buildProposal(
      [{ path: 'src/other.ts', kind: 'create', content: 'x' }],
      ctx,
    );
    expect(exists.errors[0]?.code).toBe('already_exists');
  });

  it('requires content for a create', async () => {
    const res = await buildProposal([{ path: 'src/new.ts', kind: 'create' }], ctx);
    expect(res.errors[0]?.code).toBe('missing_content');
  });

  it('builds a create with one hunk', async () => {
    const res = await buildProposal([{ path: 'src/new.ts', kind: 'create', content: 'one\ntwo\n' }], ctx);
    expect(res.ok).toBe(true);
    expect(res.files[0]?.hunks.length).toBe(1);
    expect(res.files[0]?.proposedText).toBe('one\ntwo\n');
  });

  it('builds a delete', async () => {
    const res = await buildProposal([{ path: 'src/other.ts', kind: 'delete' }], ctx);
    expect(res.ok).toBe(true);
    expect(res.files[0]?.proposedText).toBe('');
  });

  it('refuses to delete a file that does not exist', async () => {
    const res = await buildProposal([{ path: 'src/nope.ts', kind: 'delete' }], ctx);
    expect(res.errors[0]?.code).toBe('does_not_exist');
  });

  it('checks the expected base hash when the agent provides one', async () => {
    const stale = await buildProposal(
      [
        {
          path: 'src/other.ts',
          kind: 'modify',
          edits: [{ oldText: 'two', newText: 'TWO' }],
          expectedBaseHash: 'deadbeef',
        },
      ],
      ctx,
    );
    expect(stale.errors[0]?.code).toBe('base_hash_mismatch');
    expect(stale.errors[0]?.message).toContain('Read it again');
  });

  it('accepts a correct expected base hash', async () => {
    const first = await buildProposal(
      [{ path: 'src/other.ts', kind: 'modify', edits: [{ oldText: 'two', newText: 'TWO' }] }],
      ctx,
    );
    const hash = first.files[0]!.baseHash;
    const res = await buildProposal(
      [
        {
          path: 'src/other.ts',
          kind: 'modify',
          edits: [{ oldText: 'two', newText: 'TWO' }],
          expectedBaseHash: hash,
        },
      ],
      ctx,
    );
    expect(res.ok).toBe(true);
  });

  it('refuses two changes for the same file', async () => {
    const res = await buildProposal(
      [
        { path: 'src/other.ts', kind: 'modify', edits: [{ oldText: 'one', newText: '1' }] },
        { path: 'src/other.ts', kind: 'modify', edits: [{ oldText: 'two', newText: '2' }] },
      ],
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('invalid');
    expect(res.errors[0]?.message).toContain('twice');
  });

  it('reports every invalid change, not just the first', async () => {    const res = await buildProposal(
      [
        { path: 'src/nope.ts', kind: 'modify', edits: [{ oldText: 'a', newText: 'b' }] },
        { path: 'src/other.ts', kind: 'create', content: 'x' },
      ],
      ctx,
    );
    expect(res.errors.length).toBe(2);
    expect(res.files.length).toBe(0);
  });
});
