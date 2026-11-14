// Typed message protocol between the extension host and the chat webview.
// The host validates every webview→host message with zod
// (src/ui/chatProtocolSchemas.ts) before acting on it; host→webview messages
// come from our own host code. Agent markdown is sanitized in the webview.

export interface ContextChip {
  readonly path: string; // workspace-relative
  readonly selection?: { readonly startLine: number; readonly endLine: number };
  /** Set when the chip came from an @symbol mention. */
  readonly symbol?: { readonly name: string; readonly kind: string; readonly line: number };
}

/** A symbol the user can mention with @. */
export interface MentionSymbol {
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly line: number;
  readonly signature: string;
}

export interface Message {
  readonly id: string;
  readonly role: 'user' | 'agent' | 'system' | 'tool' | 'change' | 'command';
  /** For user/system: plain text. For agent: markdown to render sanitized. For tool: name. */
  readonly text: string;
  readonly streaming?: boolean;
  readonly modelLabel?: string;
  /** Tool rows: call arguments and result, collapsed by default in the UI. */
  readonly toolCallId?: string;
  readonly toolArgs?: string;
  readonly toolResult?: string;
  readonly expanded?: boolean;
  /** Command cards: the verbatim command, its risks and its result. */
  readonly command?: {
    readonly toolCallId: string;
    readonly command: string;
    readonly cwd: string;
    readonly risky: readonly string[];
    readonly status: string;
    readonly exitCode?: number;
    readonly durationMs?: number;
    readonly note?: string;
  };
  /** Change cards: the file, the counts and the status chip. */
  readonly change?: {
    readonly path: string;
    readonly added: number;
    readonly removed: number;
    readonly status: string;
    readonly note?: string;
    /** The change can be undone (FR-10). */
    readonly revertible?: boolean;
    /** The change set this card belongs to. */
    readonly changeSetId?: string;
  };
}

export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'send'; readonly text: string; readonly chips: readonly ContextChip[] }
  | { readonly type: 'stop' }
  | { readonly type: 'newChat' }
  | { readonly type: 'updateChip'; readonly chip: ContextChip | null }
  | { readonly type: 'copyText'; readonly text: string }
  | { readonly type: 'switchModel' }
  | { readonly type: 'openReview' }
  | { readonly type: 'approveCommand'; readonly toolCallId: string }
  | { readonly type: 'mentionFiles'; readonly query: string }
  | { readonly type: 'denyCommand'; readonly toolCallId: string }
  | { readonly type: 'revertChange'; readonly changeSetId: string }
  | {
      readonly type: 'mention';
      readonly path: string;
      /** Set when the user picked a symbol rather than a file. */
      readonly symbol?: { readonly name: string; readonly kind: string; readonly line: number };
    };

export type HostToWebviewMessage =
  | {
      readonly type: 'state';
      readonly serverState: string;
      readonly working: boolean;
      readonly pendingReviews: number;
      /** False when no model is configured yet. */
      readonly configured?: boolean;
    }
  | { readonly type: 'messages'; readonly messages: readonly Message[] }
  | { readonly type: 'streamDelta'; readonly messageId: string; readonly text: string }
  | { readonly type: 'notice'; readonly text: string }
  | { readonly type: 'chip'; readonly chip: ContextChip | null }
  | {
      readonly type: 'mentionFilesResult';
      readonly files: readonly string[];
      readonly symbols?: readonly MentionSymbol[];
    };
