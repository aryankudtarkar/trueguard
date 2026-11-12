// Typed message protocol between the extension host and the chat webview.
// Phase 1 fills this in; shapes are validated with zod on both sides.

/** Messages the webview sends to the extension host. */
export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'ping' };

/** Messages the extension host sends to the webview. */
export type HostToWebviewMessage =
  | { readonly type: 'pong' };
