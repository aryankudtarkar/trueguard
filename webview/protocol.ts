// Typed message protocol between the extension host and the chat webview.
// The host validates every webview→host message with zod
// (src/ui/chatProtocolSchemas.ts) before acting on it; host→webview messages
// come from our own host code. Agent markdown is sanitized in the webview.

export interface ContextChip {
  readonly path: string; // workspace-relative
  readonly selection?: { readonly startLine: number; readonly endLine: number };
}

export interface Message {
  readonly id: string;
  readonly role: 'user' | 'agent' | 'system' | 'tool' | 'change';
  /** For user/system: plain text. For agent: markdown to render sanitized. For tool: name. */
  readonly text: string;
  readonly streaming?: boolean;
  readonly modelLabel?: string;
  /** Tool rows: call arguments and result, collapsed by default in the UI. */
  readonly toolCallId?: string;
  readonly toolArgs?: string;
  readonly toolResult?: string;
  readonly expanded?: boolean;
  /** Change cards: the file, the counts and the status chip. */
  readonly change?: {
    readonly path: string;
    readonly added: number;
    readonly removed: number;
    readonly status: string;
    readonly note?: string;
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
  | { readonly type: 'openReview' };

export type HostToWebviewMessage =
  | { readonly type: 'state'; readonly serverState: string; readonly working: boolean; readonly pendingReviews: number }
  | { readonly type: 'messages'; readonly messages: readonly Message[] }
  | { readonly type: 'streamDelta'; readonly messageId: string; readonly text: string }
  | { readonly type: 'notice'; readonly text: string }
  | { readonly type: 'chip'; readonly chip: ContextChip | null };
