// Typed message protocol between the extension host and the chat webview.
// Both sides validate with zod (webview side: minimal structural checks;
// host side: full zod schemas in src/ui/chatProtocolSchemas.ts).

export interface ContextChip {
  readonly path: string; // workspace-relative
  readonly selection?: { readonly startLine: number; readonly endLine: number };
}

export interface Message {
  readonly id: string;
  readonly role: 'user' | 'agent' | 'system';
  /** For user/system: plain text. For agent: markdown to render sanitized. */
  readonly text: string;
  readonly streaming?: boolean;
  readonly modelLabel?: string;
}

export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'send'; readonly text: string; readonly chips: readonly ContextChip[] }
  | { readonly type: 'stop' }
  | { readonly type: 'newChat' }
  | { readonly type: 'updateChip'; readonly chip: ContextChip | null }
  | { readonly type: 'copyText'; readonly text: string }
  | { readonly type: 'switchModel' };

export type HostToWebviewMessage =
  | { readonly type: 'state'; readonly serverState: string; readonly working: boolean; readonly pendingReviews: number }
  | { readonly type: 'messages'; readonly messages: readonly Message[] }
  | { readonly type: 'streamDelta'; readonly messageId: string; readonly text: string }
  | { readonly type: 'notice'; readonly text: string }
  | { readonly type: 'chip'; readonly chip: ContextChip | null };
