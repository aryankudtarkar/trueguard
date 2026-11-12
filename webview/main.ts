import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ContextChip, HostToWebviewMessage, Message } from './protocol';

/**
 * ForgeGuard chat webview. Plain TypeScript + theme CSS variables, no framework.
 * CSP: scripts and remote content are forbidden; markdown is sanitized.
 */

const vscode = acquireVsCodeApi<{ messages?: Message[] }>();

const root = document.getElementById('root')!;

root.innerHTML = `
  <div id="msgList" role="log" aria-live="polite" aria-label="Chat messages"></div>
  <div id="composer">
    <div id="chipRow"></div>
    <textarea id="input" placeholder="Ask ForgeGuard to change code…" rows="1" aria-label="Message"></textarea>
    <div id="composerRow">
      <button id="modelPill" class="pill" aria-label="Switch model">model</button>
      <span class="spacer"></span>
      <button id="sendBtn" aria-label="Send">Send</button>
    </div>
  </div>
`;

const msgList = root.querySelector('#msgList') as HTMLDivElement;
const chipRow = root.querySelector('#chipRow') as HTMLDivElement;
const input = root.querySelector('#input') as HTMLTextAreaElement;
const sendBtn = root.querySelector('#sendBtn') as HTMLButtonElement;
const modelPill = root.querySelector('#modelPill') as HTMLButtonElement;

let messages: Message[] = [];
let working = false;
let chip: ContextChip | null = null;
let serverState = 'stopped';
let pendingReviews = 0;

function render(): void {
  renderMessages();
  renderChip();
  renderComposer();
}

function renderMessages(): void {
  msgList.replaceChildren(
    ...messages.map((m) => {
      if (m.role === 'tool') {
        return renderToolRow(m);
      }
      const el = document.createElement('div');
      el.className = `msg ${m.role}${m.streaming ? ' streaming' : ''}`;
      if (m.role === 'user') {
        el.textContent = m.text;
      } else if (m.role === 'agent' && m.text) {
        el.innerHTML = DOMPurify.sanitize(marked.parse(m.text, { async: false }));
      } else if (m.role === 'agent') {
        el.textContent = m.streaming ? '…' : '';
        el.classList.add('secondary');
      } else {
        el.textContent = m.text;
      }
      return el;
    }),
  );
  msgList.scrollTop = msgList.scrollHeight;
}

/** Collapsed tool-activity row with expandable details. */
function renderToolRow(m: Message & { role: 'tool' }): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg tool${m.expanded ? ' expanded' : ''}`;
  const head = document.createElement('button');
  head.className = 'toolHead';
  head.setAttribute('aria-expanded', String(!!m.expanded));
  // Typographic marker only: the webview ships no icon font (PRD 6.2).
  head.textContent = `${m.expanded ? '▾' : '▸'} ${m.text}${m.toolResult ? ' · done' : ' · running'}`;
  head.addEventListener('click', () => {
    void vscode.postMessage({ type: 'toggleTool', messageId: m.id });
  });
  el.appendChild(head);
  if (m.expanded) {
    const body = document.createElement('div');
    body.className = 'toolBody secondary';
    if (m.toolArgs) {
      const argsEl = document.createElement('pre');
      argsEl.textContent = `args: ${m.toolArgs}`;
      body.appendChild(argsEl);
    }
    const resEl = document.createElement('pre');
    resEl.textContent = m.toolResult ? `result: ${m.toolResult}` : 'result: (pending)';
    body.appendChild(resEl);
    el.appendChild(body);
  }
  return el;
}

function renderChip(): void {
  chipRow.replaceChildren();
  if (!chip) { return; }
  const chipEl = document.createElement('span');
  chipEl.className = 'chip';
  const label = chip.selection ? `${chip.path} (${chip.selection.startLine}–${chip.selection.endLine})` : chip.path;
  chipEl.textContent = label;
  chipEl.title = 'Context sent with your next message. Click to remove.';
  chipEl.setAttribute('role', 'button');
  chipEl.setAttribute('tabindex', '0');
  const remove = () => {
    chip = null;
    void vscode.postMessage({ type: 'updateChip', chip: null });
    renderChip();
  };
  chipEl.addEventListener('click', remove);
  chipEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); remove(); } });
  chipRow.appendChild(chipEl);
}

function renderComposer(): void {
  sendBtn.textContent = working ? 'Stop' : 'Send';
  sendBtn.setAttribute('aria-label', working ? 'Stop generating' : 'Send message');
  const offline = serverState !== 'ready';
  input.disabled = offline;
  sendBtn.disabled = offline && !working;
  input.placeholder = offline ? 'TrueForge is not running' : 'Ask ForgeGuard to change code…';
  modelPill.textContent = pendingReviews > 0 ? `${pendingReviews} to review` : 'model';
}

function sendMessage(): void {
  const text = input.value.trim();
  if (!text || working || serverState !== 'ready') { return; }
  input.value = '';
  autosize();
  const chips = chip ? [chip] : [];
  void vscode.postMessage({ type: 'send', text, chips });
}

sendBtn.addEventListener('click', () => {
  if (working) { void vscode.postMessage({ type: 'stop' }); return; }
  sendMessage();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autosize(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}
input.addEventListener('input', autosize);

modelPill.addEventListener('click', () => {
  void vscode.postMessage({ type: 'switchModel' });
});

window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as HostToWebviewMessage;
  switch (m.type) {
    case 'state': {
      serverState = m.serverState;
      working = m.working;
      pendingReviews = m.pendingReviews;
      break;
    }
    case 'messages': {
      messages = [...m.messages];
      break;
    }
    case 'notice': {
      messages = [...messages, { id: `n${Date.now()}`, role: 'system', text: m.text }];
      break;
    }
    case 'chip': {
      chip = m.chip;
      break;
    }
  }
  render();
});

render();
void vscode.postMessage({ type: 'ready' });
