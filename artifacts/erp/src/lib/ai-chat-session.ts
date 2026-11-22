export interface ChatAnswer {
  tool: string;
  ok: boolean;
  text: string;
  table?: { columns: string[]; rows: Array<Record<string, unknown>>; totalRows: number };
  link?: { label: string; path: string };
  detail?: string;
  download?: { label: string; url: string };
  steps?: string[];
  context?: string;
}

export interface Pending {
  token: string;
  summary: string;
  items: Array<{ label: string; detail: string; sensitive?: string }>;
}
export type PendingState = "waiting" | "running" | "approved" | "cancelled" | "expired";
export interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  answer?: ChatAnswer;
  failed?: boolean;
  pending?: Pending;
  pendingState?: PendingState;
  photos?: string[];
}
export interface Attachment { name: string; type: string; data: string; preview: string }
interface ChatState {
  messages: Message[];
  input: string;
  sending: boolean;
  attachments: Attachment[];
  attachError: string;
  storageError: boolean;
}

const PREFIX = "erp-ai-chat:v1:";
const sessions = new Map<string, ChatSession>();
function browserStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; } catch { return undefined; }
}

/** Tab-local, user/company-scoped state. Async responses survive route unmounts. */
export class ChatSession {
  private listeners = new Set<() => void>();
  private disposed = false;
  private sequence = 1;
  private state: ChatState = {
    messages: [], input: "", sending: false, attachments: [], attachError: "", storageError: false,
  };
  constructor(private key: string, private storage = browserStorage()) {
    try {
      const raw = storage?.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version === 1 && Array.isArray(saved.messages) && typeof saved.input === "string" &&
          saved.messages.every((m: Message) => m && Number.isSafeInteger(m.id) &&
            (m.role === "user" || m.role === "assistant") && typeof m.text === "string")) {
          this.state = { ...this.state, messages: saved.messages, input: saved.input };
          if (saved.interrupted) this.state.messages.push({
            id: Math.max(0, ...saved.messages.map((m: Message) => m.id)) + 1,
            role: "assistant", failed: true,
            text: "頁面已重新載入，無法確認上一個請求的結果。如曾確認執行，請先到對應單據頁查看，避免重複操作。",
          });
        }
      }
    } catch { this.state.storageError = true; }
    this.sequence = Math.max(0, ...this.state.messages.map((m) => m.id)) + 1;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  nextId = () => this.sequence++;
  set<K extends keyof ChatState>(key: K, value: ChatState[K] | ((previous: ChatState[K]) => ChatState[K])) {
    if (this.disposed) return;
    this.state = { ...this.state, [key]: typeof value === "function" ? value(this.state[key]) : value };
    // Never save image bytes, blob URLs, or confirmation tokens to browser storage.
    const messages = this.state.messages.map(({ photos: _photos, pending, ...m }) => ({
      ...m,
      ...(pending ? {
        pending: { ...pending, token: "" },
        pendingState: m.pendingState === "waiting" || m.pendingState === "running" ? "expired" : m.pendingState,
      } : {}),
    }));
    try {
      if (!this.storage) throw new Error("Storage unavailable");
      this.storage.setItem(this.key, JSON.stringify({
        version: 1, messages, input: this.state.input, interrupted: this.state.sending,
      }));
    } catch { this.state = { ...this.state, storageError: true }; }
    this.listeners.forEach((notify) => notify());
  }
  dispose() {
    this.disposed = true;
    const urls = [...this.state.attachments.map((a) => a.preview),
      ...this.state.messages.flatMap((m) => m.photos || [])];
    urls.filter((url) => url.startsWith("blob:")).forEach((url) => URL.revokeObjectURL(url));
    try { this.storage?.removeItem(this.key); } catch { /* Storage may be disabled. */ }
    this.listeners.clear();
  }
}

export function getChatSession(scope: string): ChatSession {
  let session = sessions.get(scope);
  if (!session) {
    session = new ChatSession(PREFIX + scope);
    sessions.set(scope, session);
  }
  return session;
}

/** Also invalidates outstanding callbacks so a logged-out response cannot restore data. */
export function retainChatScope(scope: string | null) {
  for (const [key, session] of sessions) {
    if (key !== scope) { session.dispose(); sessions.delete(key); }
  }
  const storage = browserStorage();
  try {
    if (!storage) return;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX) && key !== PREFIX + scope) storage.removeItem(key);
    }
  } catch { /* In-memory state is still isolated when storage is unavailable. */ }
}
