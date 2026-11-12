import { z } from 'zod';
import { contentHash } from '../util/hash';
import { capJson } from '../util/jsonCap';
import { PathGuardError, type ResolvedPath } from './pathGuard';

/**
 * Editor tools exposed over MCP (FR-3). Handlers receive injected `deps` so
 * unit tests can back them with temp directories instead of the vscode API;
 * the vscode-backed defaults live in vscodeTools.ts.
 */

export const LINE_CAP_DEFAULT = 400;
export const LINE_CAP_MAX = 2000;
/** Files larger than this are refused: the agent must narrow the request. */
export const MAX_FILE_BYTES = 2_000_000;

export const readFileSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path'),
  startLine: z.number().int().min(1).optional().describe('First line to return (1-based)'),
  endLine: z.number().int().min(1).optional().describe('Last line to return (inclusive)'),
});

export const listFilesSchema = z.object({
  glob: z.string().min(1).optional().describe('Glob relative to the workspace, e.g. "src/**/*.ts"'),
  maxResults: z.number().int().min(1).max(1000).optional().describe('Max file paths (default 200)'),
});

export const searchTextSchema = z.object({
  pattern: z.string().min(1).describe('Text to find (plain substring unless isRegex)'),
  glob: z.string().min(1).optional().describe('Restrict to files matching this glob'),
  isRegex: z.boolean().optional().describe('Treat pattern as a regular expression'),
  maxResults: z.number().int().min(1).max(200).optional().describe('Max matches (default 50)'),
});

export const getDiagnosticsSchema = z.object({
  path: z.string().optional().describe('Workspace-relative path to filter diagnostics'),
});

export const getEditorContextSchema = z.object({});

export type ReadFileInput = z.infer<typeof readFileSchema>;
export type ListFilesInput = z.infer<typeof listFilesSchema>;
export type SearchTextInput = z.infer<typeof searchTextSchema>;
export type GetDiagnosticsInput = z.infer<typeof getDiagnosticsSchema>;
export type GetEditorContextInput = z.infer<typeof getEditorContextSchema>;

/** Capabilities the tool handlers need; vscode-backed by default. */
export interface EditorToolDeps {
  /** Absolute workspace root(s). */
  workspaceRoots(): Promise<string[]> | string[];
  /** Text of a file (dirty buffer first); {content, totalLines}. */
  readText(absolute: string): Promise<{ content: string; totalLines: number }>;
  /** Workspace-relative paths respecting .gitignore. */
  listFiles(glob: string | undefined, maxResults: number): Promise<string[]>;
  getDiagnostics(path: string | undefined): Promise<Array<{ path: string; severity: string; line: number; message: string }>>;
  getEditorContext(): Promise<unknown>;
  /** Allow reads of secret-looking files (.env, *.pem). Off by default. */
  allowSecretReads(): boolean;
  /** Maximum size in bytes of one tool result (FR-9, default 16 KB). */
  outputCapBytes(): number;
  /** Size of a file in bytes, when it can be determined cheaply. */
  sizeOf?(absolute: string): Promise<number | undefined>;
}

export interface ToolContext {
  deps: EditorToolDeps;
  /** Anything that resolves input paths (PathGuard or a proxy). */
  guard: PathResolver;
}

export interface PathResolver {
  resolve(input: string, opts?: { mustExist?: boolean }): Promise<ResolvedPath>;
}

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Serialize a tool result under the byte cap (FR-9). The payload always stays
 * valid JSON: bulky strings inside it are elided head/tail, not cut mid-way.
 */
function jsonOut(value: unknown, ctx: ToolContext): ToolResult {
  const { text } = capJson(value, ctx.deps.outputCapBytes());
  return { content: [{ type: 'text', text }] };
}

function errorOut(code: string, message: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }], isError: true };
}

/**
 * Wrap a handler so that every failure becomes a structured error the agent
 * can act on (never a thrown exception, never a crash).
 */
export async function runTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PathGuardError) {
      return errorOut(e.code, e.message);
    }
    return errorOut('internal', String(e instanceof Error ? e.message : e));
  }
}

/** Define a tool handler that never throws: errors come back structured. */
function defineTool<A>(fn: (args: A, ctx: ToolContext) => Promise<ToolResult>) {
  return async (args: A, ctx: ToolContext): Promise<ToolResult> => runTool(() => fn(args, ctx));
}

export interface ToolRegistrar {
  registerTool(
    name: string,
    def: { description: string; inputSchema: Record<string, z.ZodType> },
    handler: (args: unknown, extra?: { requestId?: string | number }) => Promise<ToolResult>,
  ): void;
}

export function registerEditorTools(server: ToolRegistrar, ctx: ToolContext): void {
  server.registerTool(
    'read_file',
    {
      description:
        'Read a workspace file with numbered lines. Reads the unsaved buffer if the file is open in an editor. ' +
        `Default cap ${LINE_CAP_DEFAULT} lines; use startLine/endLine for ranges.`,
      inputSchema: zodToShape(readFileSchema),
    },
    async (raw) => runTool(() => readFile(readFileSchema.parse(raw), ctx)),
  );
  server.registerTool(
    'list_files',
    {
      description: 'List workspace files (respects .gitignore) matching an optional glob.',
      inputSchema: zodToShape(listFilesSchema),
    },
    async (raw) => runTool(() => listFiles(listFilesSchema.parse(raw), ctx)),
  );
  server.registerTool(
    'search_text',
    {
      description: 'Search file contents (substring or regex), returns path:line: snippet, capped.',
      inputSchema: zodToShape(searchTextSchema),
    },
    async (raw) => runTool(() => searchText(searchTextSchema.parse(raw), ctx)),
  );
  server.registerTool(
    'get_diagnostics',
    {
      description: 'VS Code diagnostics (errors/warnings) for a file or the whole workspace.',
      inputSchema: zodToShape(getDiagnosticsSchema),
    },
    async (raw) => runTool(() => getDiagnostics(getDiagnosticsSchema.parse(raw), ctx)),
  );
  server.registerTool(
    'get_editor_context',
    {
      description: 'Current editor state: active file, selection, visible range, open tabs.',
      inputSchema: zodToShape(getEditorContextSchema),
    },
    async () => getEditorContext({}, ctx),
  );
}

/** SDK wants a zod shape: { key: zodSchema }. */
function zodToShape(schema: z.ZodObject<z.ZodRawShape>): z.ZodRawShape {
  return schema.shape;
}

export const readFile = defineTool(async (args: ReadFileInput, ctx: ToolContext): Promise<ToolResult> => {
  if (args.startLine !== undefined && args.endLine !== undefined && args.endLine < args.startLine) {
    return errorOut('invalid', `endLine ${args.endLine} is before startLine ${args.startLine}`);
  }
  const { absolute } = await ctx.guard.resolve(args.path, { mustExist: true });
  const size = await ctx.deps.sizeOf?.(absolute);
  if (size !== undefined && size > MAX_FILE_BYTES) {
    return errorOut(
      'too_large',
      `file is ${size} bytes, over the ${MAX_FILE_BYTES} byte limit. Narrow the request with startLine/endLine.`,
    );
  }
  const { content } = await ctx.deps.readText(absolute);
  const lines = content.split(/\r\n|\r|\n/);
  // A trailing newline produces a final empty element; it is not a line.
  const lastContent = lines.length > 0 && lines.at(-1) === '' ? lines.length - 1 : lines.length;
  const startLine = args.startLine ?? 1;
  const endLine = Math.min(args.endLine ?? startLine + LINE_CAP_DEFAULT - 1, lastContent, startLine + LINE_CAP_MAX - 1);
  if (startLine > lastContent) {
    return errorOut('invalid', `startLine ${startLine} beyond end of file (${lastContent} lines)`);
  }
  const slice = lines.slice(startLine - 1, endLine);
  const gutter = String(endLine).length;
  const numbered = slice.map((l, i) => `${String(startLine + i).padStart(gutter)}| ${l}`).join('\n');
  return jsonOut(
    {
      path: args.path,
      startLine,
      endLine,
      totalLines: lastContent,
      contentHash: contentHash(content),
      truncated: endLine < lastContent,
      lines: numbered,
    },
    ctx,
  );
});

export const listFiles = defineTool(async (args: ListFilesInput, ctx: ToolContext): Promise<ToolResult> => {
  const max = args.maxResults ?? 200;
  const files = await ctx.deps.listFiles(args.glob, max + 1);
  const truncated = files.length > max;
  return jsonOut({ files: files.slice(0, max), truncated, count: Math.min(files.length, max) }, ctx);
});

export const searchText = defineTool(async (args: SearchTextInput, ctx: ToolContext): Promise<ToolResult> => {
  let re: RegExp | undefined;
  try {
    re = args.isRegex ? new RegExp(args.pattern) : undefined;
  } catch (e) {
    return errorOut('invalid', `bad regex: ${String(e instanceof Error ? e.message : e)}`);
  }
  const max = args.maxResults ?? 50;
  const files = await ctx.deps.listFiles(args.glob, 2000);
  const matches: Array<{ path: string; line: number; snippet: string }> = [];
  for (const rel of files) {
    if (matches.length >= max) { break; }
    try {
      const { absolute } = await ctx.guard.resolve(rel, { mustExist: true });
      const size = await ctx.deps.sizeOf?.(absolute);
      if (size !== undefined && size > MAX_FILE_BYTES) { continue; } // too big to scan
      const { content } = await ctx.deps.readText(absolute);
      const lines = content.split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        const line = lines[i] ?? '';
        const hit = re ? re.test(line) : line.includes(args.pattern);
        if (hit) {
          matches.push({ path: rel, line: i + 1, snippet: line.trim().slice(0, 160) });
        }
      }
    } catch {
      continue; // unreadable or escaped path: skip, never crash the search
    }
  }
  return jsonOut({ matches, count: matches.length, truncated: matches.length >= max }, ctx);
});

export const getDiagnostics = defineTool(async (args: GetDiagnosticsInput, ctx: ToolContext): Promise<ToolResult> => {
  const all = await ctx.deps.getDiagnostics(args.path);
  return jsonOut({ diagnostics: all, count: all.length }, ctx);
});

export const getEditorContext = defineTool(async (_args: GetEditorContextInput, ctx: ToolContext): Promise<ToolResult> =>
  jsonOut({ context: await ctx.deps.getEditorContext() }, ctx),
);
