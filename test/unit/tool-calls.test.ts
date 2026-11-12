import { describe, expect, it } from 'vitest';
import { ToolCallBuffer, extractToolCalls } from '../../src/trueforge/schemas';
import { toolLabel } from '../../src/ui/chatProvider';

/**
 * Tool calls are streamed as fragments (verified transcript
 * docs/spikes/approval-allow-transcript.md): the name arrives in one delta
 * and the JSON arguments in the next, keyed by `index`.
 */
describe('tool call buffer', () => {
  it('merges a name and its arguments from two deltas', () => {
    const buf = new ToolCallBuffer();
    buf.add([{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } }]);
    buf.add([{ index: 0, function: { arguments: '{"path":"src/app.ts"}' } }]);
    const calls = buf.drain();
    expect(calls.length).toBe(1);
    expect(calls[0]?.id).toBe('call_1');
    expect(calls[0]?.name).toBe('read_file');
    expect(calls[0]?.arguments).toBe('{"path":"src/app.ts"}');
  });

  it('keeps parallel calls apart', () => {
    const buf = new ToolCallBuffer();
    buf.add([
      { index: 0, id: 'a', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
      { index: 1, id: 'b', function: { name: 'search_text', arguments: '{"pattern":"x"}' } },
    ]);
    const calls = buf.drain();
    expect(calls.map((c) => c.name).sort()).toEqual(['read_file', 'search_text']);
  });

  it('ignores malformed fragments instead of throwing', () => {
    const buf = new ToolCallBuffer();
    buf.add('nonsense');
    buf.add([{ index: 'x' }, null, 42]);
    expect(buf.complete()).toEqual([]);
    expect(buf.drain()).toEqual([]);
  });

  it('drains only once', () => {
    const buf = new ToolCallBuffer();
    buf.add([{ index: 0, id: 'a', function: { name: 'read_file', arguments: '{}' } }]);
    expect(buf.drain().length).toBe(1);
    expect(buf.drain().length).toBe(0);
  });
});

describe('extractToolCalls', () => {
  it('reads a complete tool call from a model.message event', () => {
    const calls = extractToolCalls({
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    });
    expect(calls[0]?.name).toBe('read_file');
  });

  it('skips unknown shapes', () => {
    expect(extractToolCalls({ tool_calls: [{ nope: true }] })).toEqual([]);
    expect(extractToolCalls({})).toEqual([]);
  });
});

describe('tool label', () => {
  it('shows the tool name and its main argument', () => {
    expect(toolLabel('read_file', '{"path":"src/app.ts"}')).toBe('read_file src/app.ts');
    expect(toolLabel('search_text', '{"pattern":"todo"}')).toBe('search_text todo');
    expect(toolLabel('run_command', '{"command":"npm test"}')).toBe('run_command npm test');
  });

  it('falls back to the bare tool name', () => {
    expect(toolLabel('get_diagnostics', undefined)).toBe('get_diagnostics');
    expect(toolLabel('get_diagnostics', 'not json')).toBe('get_diagnostics');
    expect(toolLabel('get_diagnostics', '{"other":1}')).toBe('get_diagnostics');
  });
});
