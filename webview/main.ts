import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ContextChip, HostToWebviewMessage, MentionSymbol, Message } from './protocol';

/**
 * TrueGuard chat webview. Plain TypeScript + theme CSS variables, no framework.
 * CSP: scripts and remote content are forbidden; markdown is sanitized.
 */

const vscode = acquireVsCodeApi<{ messages?: Message[] }>();

const root = document.getElementById('root')!;

root.innerHTML = `
  <div id="msgList" role="log" aria-live="polite" aria-label="Chat messages">
    <div id="welcome">
      <div class="welcomeTitle">TrueGuard</div>
      <div class="welcomeText">An agent that asks before it writes.</div>
      <div id="welcomeActions"></div>
    </div>
  </div>
  <div id="composer">
    <div id="chipRow"></div>
    <textarea id="input" placeholder="Ask TrueGuard to change code…" rows="1" aria-label="Message"></textarea>
    <div id="composerRow">
      <button id="modelPill" class="pill" aria-label="Switch mode or model">Fast</button>
      <span class="spacer"></span>
      <button id="sendBtn" aria-label="Send">Send</button>
    </div>
  </div>
`;

const msgList = root.querySelector('#msgList') as HTMLDivElement;
const welcome = root.querySelector('#welcome') as HTMLDivElement;
const welcomeActions = root.querySelector('#welcomeActions') as HTMLDivElement;
const chipRow = root.querySelector('#chipRow') as HTMLDivElement;
const input = root.querySelector('#input') as HTMLTextAreaElement;
const sendBtn = root.querySelector('#sendBtn') as HTMLButtonElement;
const modelPill = root.querySelector('#modelPill') as HTMLButtonElement;

let messages: Message[] = [];
let working = false;
let chip: ContextChip | null = null;
let serverState = 'stopped';
let pendingReviews = 0;
let configured = true;
let modeLabel = 'Fast';
let modeTooltip = 'Fast';

function render(): void {
  renderMessages();
  renderChip();
  renderComposer();
}

function renderMessages(): void {
  // The welcome card is only for an empty chat.
  welcome.hidden = messages.length > 0;
  if (messages.length === 0) { renderWelcome(); }

  msgList.replaceChildren(
    ...messages.map((m) => {
      if (m.role === 'tool') {
        return renderToolRow(m);
      }
      if (m.role === 'change') {
        return renderChangeCard(m);
      }
      if (m.role === 'command') {
        return renderCommandCard(m);
      }
      const el = document.createElement('div');
      el.className = `msg ${m.role}${m.streaming ? ' streaming' : ''}`;
      if (m.role === 'user') {
        el.textContent = m.text;
      } else if (m.role === 'agent' && m.text) {
        el.innerHTML = DOMPurify.sanitize(marked.parse(m.text, { async: false }));
        if (m.modelLabel) {
          const label = document.createElement('div');
          label.className = 'modelLabel secondary';
          label.textContent = m.modelLabel;
          el.appendChild(label);
        }
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

/** Change card: file, counts, status chip and a Review button (PRD 6.4). */
function renderChangeCard(m: Message & { role: 'change' }): HTMLElement {
  const change = m.change;
  const el = document.createElement('div');
  el.className = 'msg change';
  const head = document.createElement('div');
  head.className = 'changeHead';
  const name = document.createElement('span');
  name.className = 'changeName';
  name.textContent = change?.path ?? m.text;
  const counts = document.createElement('span');
  counts.className = 'changeCounts';
  counts.textContent = change ? `+${change.added} -${change.removed}` : '';
  const chip = document.createElement('span');
  chip.className = `chipStatus ${statusClass(change?.status ?? '')}`;
  chip.textContent = change?.status ?? '';
  head.append(name, counts, chip);
  el.appendChild(head);

  if (change?.note) {
    const note = document.createElement('div');
    note.className = 'secondary changeNote';
    note.textContent = change.note;
    el.appendChild(note);
  }

  if (change?.revertible && change.changeSetId) {
    const revert = document.createElement('button');
    revert.className = 'pill';
    revert.textContent = 'Revert';
    revert.setAttribute('aria-label', `Revert the change to ${change.path}`);
    revert.addEventListener('click', () => {
      void vscode.postMessage({ type: 'revertChange', changeSetId: change.changeSetId ?? '' });
    });
    el.appendChild(revert);
  }

  if (change && change.status === 'Awaiting review') {
    const review = document.createElement('button');
    review.className = 'pill';
    review.textContent = 'Review';
    review.setAttribute('aria-label', `Review the changes to ${change.path}`);
    review.addEventListener('click', () => {
      void vscode.postMessage({ type: 'openReview' });
    });
    el.appendChild(review);
  }
  return el;
}

/** Command card: the verbatim command, its risks, and Allow / Deny (PRD 6.4). */
function renderCommandCard(m: Message & { role: 'command' }): HTMLElement {
  const command = m.command;
  const el = document.createElement('div');
  el.className = 'msg command';
  const head = document.createElement('div');
  head.className = 'changeHead';
  const name = document.createElement('span');
  name.className = 'changeName';
  name.textContent = command?.command ?? m.text;
  const chip = document.createElement('span');
  chip.className = `chipStatus ${command?.risky.length ? 'bad' : 'pending'}`;
  chip.textContent = command?.status ?? '';
  head.append(name, chip);
  el.appendChild(head);

  if (command?.cwd) {
    const cwd = document.createElement('div');
    cwd.className = 'secondary changeNote';
    cwd.textContent = `in ${command.cwd}`;
    el.appendChild(cwd);
  }

  if (command?.risky.length) {
    const risk = document.createElement('div');
    risk.className = 'commandRisk';
    risk.textContent = `This command ${command.risky.join(', ')}.`;
    el.appendChild(risk);
  }

  if (command?.status === 'Awaiting approval') {
    const row = document.createElement('div');
    row.className = 'commandRow';
    const allow = document.createElement('button');
    allow.textContent = 'Allow';
    allow.setAttribute('aria-label', `Allow the command ${command?.command ?? ''}`);
    allow.addEventListener('click', () => {
      void vscode.postMessage({ type: 'approveCommand', toolCallId: command?.toolCallId ?? '' });
    });
    const deny = document.createElement('button');
    deny.className = 'pill';
    deny.textContent = 'Deny';
    deny.setAttribute('aria-label', `Deny the command ${command?.command ?? ''}`);
    deny.addEventListener('click', () => {
      void vscode.postMessage({ type: 'denyCommand', toolCallId: command?.toolCallId ?? '' });
    });
    row.append(allow, deny);
    el.appendChild(row);
  } else if (command?.exitCode !== undefined) {
    const result = document.createElement('div');
    result.className = 'secondary changeNote';
    result.textContent = `Exit code ${command.exitCode} · ${Math.round((command.durationMs ?? 0) / 100) / 10}s`;
    el.appendChild(result);
  }
  return el;
}

/** CSS class for a status chip. */
function statusClass(status: string): string {
  switch (status) {
    case 'Verified':
      return 'ok';
    case 'Conflict':
    case 'Failed check':
      return 'bad';
    case 'Rejected':
      return 'muted';
    default:
      return 'pending';
  }
}

/**
 * The empty state (PRD 6.4): a title, one sentence and three starter chips.
 * When no model is set up yet, the first chip is the setup itself.
 */
function renderWelcome(): void {
  welcomeActions.replaceChildren();
  const starters: Array<{ label: string; text: string }> = configured
    ? [
        { label: 'Explain this file', text: 'Explain what this file does, in three sentences.' },
        { label: 'Find a bug', text: 'Look for a bug in the open file and tell me what you find.' },
        { label: 'Add a test', text: 'Write a test for the open file.' },
      ]
    : [
        { label: 'Set up a model', text: '' },
        { label: 'Check the setup', text: '' },
      ];
  for (const starter of starters) {
    const chip = document.createElement('button');
    chip.className = 'starter';
    chip.textContent = starter.label;
    chip.setAttribute('aria-label', starter.label);
    chip.addEventListener('click', () => {
      if (starter.text) {
        input.value = starter.text;
        input.focus();
        autosize();
        return;
      }
      void vscode.postMessage(
        starter.label === 'Set up a model'
          ? { type: 'openWalkthrough' }
          : { type: 'checkSetup' },
      );
    });
    welcomeActions.appendChild(chip);
  }
}

/** Collapsed tool-activity row with expandable details. */
function renderToolRow(m: Message & { role: 'tool' }): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg tool${m.expanded ? ' expanded' : ''}`;
  const head = document.createElement('button');
  head.className = 'toolHead';
  head.setAttribute('aria-expanded', String(!!m.expanded));
  head.setAttribute('aria-label', `Tool activity: ${m.text}`);
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
  const noModel = !configured;
  input.disabled = offline || noModel;
  sendBtn.disabled = (offline || noModel) && !working;
  input.placeholder = noModel
    ? 'Add a model in Settings (TrueGuard: Models) to start'
    : offline
      ? 'TrueForge is not running'
      : 'Ask TrueGuard to change code…';
  modelPill.textContent = pendingReviews > 0 ? `${pendingReviews} to review` : modeLabel;
  modelPill.title = modeTooltip;
  modelPill.setAttribute('aria-label', modeTooltip);
}

function sendMessage(): void {
  const text = input.value.trim();
  if (!text || working || serverState !== 'ready') { return; }
  input.value = '';
  autosize();
  const chips = chip ? [chip] : [];
  void vscode.postMessage({ type: 'send', text, chips });
}

/**
 * @-mentions (FR-12): when the composer sees an "@", the host is asked for
 * the matching workspace files; the user picks one and it becomes a chip.
 */
async function requestMentionFiles(query: string): Promise<void> {
  await vscode.postMessage({ type: 'mentionFiles', query });
}

function insertMention(name: string, chip?: { path: string; symbol?: { name: string; kind: string; line: number } }): void {
  const value = input.value;
  const at = value.lastIndexOf('@');
  if (at >= 0) {
    const rest = value.slice(value.indexOf(' ', at) + 1);
    input.value = `${value.slice(0, at)}${name} ${rest}`;
  }
  input.focus();
  void vscode.postMessage({ type: 'mention', path: chip?.path ?? name, ...(chip?.symbol ? { symbol: chip.symbol } : {}) });
}

function showMentionPicker(files: readonly string[], symbols: readonly MentionSymbol[] = []): void {
  if (!files.length && !symbols.length) { return; }
  const list = document.createElement('div');
  list.className = 'mentionList';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Files and symbols to mention');

  if (symbols.length) {
    const heading = document.createElement('div');
    heading.className = 'mentionHeading';
    heading.textContent = 'Symbols';
    list.appendChild(heading);
    for (const symbol of symbols) {
      const item = document.createElement('button');
      item.className = 'mentionItem';
      item.textContent = `${symbol.name} · ${symbol.kind} · ${symbol.path}:${symbol.line}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-label', `Mention ${symbol.name}, ${symbol.kind} in ${symbol.path}`);
      item.addEventListener('click', () => {
        insertMention(symbol.name, {
          path: symbol.path,
          symbol: { name: symbol.name, kind: symbol.kind, line: symbol.line },
        });
        list.remove();
      });
      list.appendChild(item);
    }
  }

  if (files.length) {
    if (symbols.length) {
      const heading = document.createElement('div');
      heading.className = 'mentionHeading';
      heading.textContent = 'Files';
      list.appendChild(heading);
    }
    for (const file of files) {
      const item = document.createElement('button');
      item.className = 'mentionItem';
      item.textContent = file;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-label', `Mention ${file}`);
      item.addEventListener('click', () => {
        insertMention(file);
        list.remove();
      });
      list.appendChild(item);
    }
  }
  chipRow.before(list);
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
input.addEventListener('input', () => {
  autosize();
  const value = input.value;
  const at = value.lastIndexOf('@');
  if (at >= 0 && !value.slice(at).includes(' ')) {
    void requestMentionFiles(value.slice(at + 1));
  }
});

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
      configured = m.configured !== false;
      modeLabel = m.mode ?? modeLabel;
      modeTooltip = m.modeTooltip ?? modeTooltip;
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
    case 'mentionFilesResult': {
      if (m.files.length || m.symbols?.length) { showMentionPicker(m.files, m.symbols ?? []); }
      break;
    }
  }
  render();
});

render();
void vscode.postMessage({ type: 'ready' });
