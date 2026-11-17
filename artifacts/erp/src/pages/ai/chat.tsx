import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowUpRight, Camera, Check, Download, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatAnswer {
  tool: string;
  ok: boolean;
  text: string;
  table?: { columns: string[]; rows: Array<Record<string, unknown>>; totalRows: number };
  link?: { label: string; path: string };
  detail?: string;
  /** 站外的下載連結（報價單 PDF） */
  download?: { label: string; url: string };
  /** AI 這一輪做了哪些事 */
  steps?: string[];
  /** 這一輪產生的單號，下一輪要帶回去，AI 才接得上「剛剛那張」 */
  context?: string;
}

/** AI 想做、但要使用者本人按確認才會執行的動作 */
interface Pending {
  token: string;
  summary: string;
  items: Array<{ label: string; detail: string; sensitive?: string }>;
}

type PendingState = "waiting" | "running" | "approved" | "cancelled";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  answer?: ChatAnswer;
  failed?: boolean;
  pending?: Pending;
  pendingState?: PendingState;
  /** 使用者這則訊息附的圖片（只留縮圖網址給畫面顯示） */
  photos?: string[];
}

/** 準備送出的圖片 */
interface Attachment { name: string; type: string; data: string; preview: string }

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("讀不到這個檔案"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 手機拍的照片動輒好幾 MB：先在瀏覽器縮到長邊 1800 像素、轉成 JPG 再上傳，傳得快也省 AI 費用。
 * 瀏覽器解不開的格式（部分 HEIC）就原檔上傳，由伺服器判斷能不能讀。
 */
async function prepareImage(file: File): Promise<Attachment> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("轉檔失敗");
    return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data: await readAsBase64(blob), preview: URL.createObjectURL(blob) };
  } catch {
    if (file.size > MAX_PHOTO_BYTES) throw new Error(`${file.name} 太大（上限 8MB）`);
    return { name: file.name, type: file.type || "image/jpeg", data: await readAsBase64(file), preview: "" };
  }
}

const OWNER_SUGGESTIONS = [
  "本月營收多少？跟上個月比呢？",
  "哪些客戶欠款超過 30 天？",
  "幫我開一張報價單",
  "新增一個客戶",
  "哪些品項庫存快不夠了？",
  "幫我寫上個月的營運月報",
];

const EMPLOYEE_SUGGESTIONS = [
  "我要報銷（先按左下角的相機附上收據）",
  "我要請假",
  "我還剩幾天特休？",
  "這個月我的出勤紀錄",
];

const TOOL_LABELS: Record<string, string> = {
  query: "查詢資料", monthly_report: "月報", anomalies: "異常偵測",
  classify_complaint: "客訴分類", product_description: "商品描述",
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return value.toLocaleString("zh-TW");
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return Number(value).toLocaleString("zh-TW");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AnswerTable({ table }: { table: NonNullable<ChatAnswer["table"]> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            {table.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-b last:border-0">
              {table.columns.map((column) => <td key={column} className="whitespace-nowrap px-3 py-1.5">{formatCell(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {table.totalRows > table.rows.length && (
        <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">共 {table.totalRows} 筆，這裡顯示前 {table.rows.length} 筆。</p>
      )}
    </div>
  );
}

function PendingCard({ pending, state, onDecide }: { pending: Pending; state?: PendingState; onDecide: (approve: boolean) => void }) {
  const risky = pending.items.some((item) => item.sensitive);
  return (
    <div className={cn("mt-3 rounded-xl border bg-background p-3", risky && "border-amber-500/60")} data-testid="ai-chat-pending">
      <p className="text-xs font-medium text-muted-foreground">按下確認後才會執行，目前還沒有變更任何資料</p>
      <ol className="mt-2 space-y-2">
        {pending.items.map((item, index) => (
          <li key={index} className="rounded-lg border px-3 py-2">
            <p className="font-medium leading-snug">{pending.items.length > 1 ? `${index + 1}. ` : ""}{item.label}</p>
            {item.sensitive && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{item.sensitive}
              </p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">詳細內容</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{item.detail}</pre>
            </details>
          </li>
        ))}
      </ol>
      {state === "waiting" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="min-h-11 flex-1 sm:flex-none" onClick={() => onDecide(true)} data-testid="ai-chat-confirm">
            <Check className="mr-1.5 h-4 w-4" />確認執行
          </Button>
          <Button type="button" variant="outline" className="min-h-11 flex-1 sm:flex-none" onClick={() => onDecide(false)} data-testid="ai-chat-cancel">
            <X className="mr-1.5 h-4 w-4" />取消
          </Button>
        </div>
      )}
      {state === "running" && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />執行中…</p>}
      {state === "approved" && <p className="mt-3 text-xs text-muted-foreground">已確認，結果在下面。</p>}
      {state === "cancelled" && <p className="mt-3 text-xs text-muted-foreground">已取消，沒有執行。</p>}
    </div>
  );
}

/** 把先前的對話整理給 AI：包含它做過的事與產生的單號，才聽得懂「那上個月呢」「把剛剛那張寄給客戶」 */
function buildHistory(messages: Message[]) {
  return messages.filter((m) => !m.failed).map((m) => {
    if (m.role === "user") return { role: m.role, content: m.photos?.length ? `${m.text}（當時附了 ${m.photos.length} 張圖片，現在已經讀不到，需要的話請使用者重傳）` : m.text };
    const parts = [m.answer?.text || m.text];
    if (m.pending) {
      const decision = m.pendingState === "cancelled" ? "已取消" : m.pendingState === "approved" ? "已確認" : "還沒決定";
      parts.push(`（等待確認的動作：${m.pending.items.map((item) => item.label).join("；")}。使用者${decision}）`);
    }
    if (m.answer?.context) parts.push(`（系統記錄：${m.answer.context}）`);
    return { role: m.role, content: parts.join("\n") };
  });
}

async function postChat(payload: Record<string, unknown>): Promise<{ answer: ChatAnswer; pending?: Pending }> {
  const response = await fetch("/erp-api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.answer) throw new Error(body?.error || body?.message || "AI 暫時無法回應");
  return body;
}

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const suggestions = isEmployee ? EMPLOYEE_SUGGESTIONS : OWNER_SUGGESTIONS;
  const nextId = useRef(1);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachError("");
    const room = MAX_PHOTOS - attachments.length;
    const picked = Array.from(files).filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name));
    if (picked.length < files.length) setAttachError("只能附圖片（照片或截圖）。PDF 請先截圖再傳。");
    if (picked.length > room) setAttachError(`一次最多附 ${MAX_PHOTOS} 張`);
    try {
      const prepared = await Promise.all(picked.slice(0, Math.max(0, room)).map(prepareImage));
      setAttachments((prev) => [...prev, ...prepared]);
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : "這張圖片讀不到");
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const appendReply = (body: { answer: ChatAnswer; pending?: Pending }) => {
    setMessages((prev) => [...prev, {
      id: nextId.current++, role: "assistant", text: body.answer.text, answer: body.answer, failed: !body.answer.ok,
      pending: body.pending, pendingState: body.pending ? "waiting" : undefined,
    }]);
  };
  const appendError = (error: unknown, fallback: string) => {
    setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: error instanceof Error ? error.message : fallback, failed: true }]);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    const photos = attachments;
    if ((!text && photos.length === 0) || sending) return;
    const history = buildHistory(messages);
    // 還沒決定的確認單，在使用者說了別的話之後就不能再按，避免執行到已經過時的動作
    setMessages((prev) => [
      ...prev.map((m) => (m.pendingState === "waiting" ? { ...m, pendingState: "cancelled" as const } : m)),
      { id: nextId.current++, role: "user", text: text || (photos.length > 0 ? "（傳了照片）" : ""), photos: photos.map((photo) => photo.preview).filter(Boolean) },
    ]);
    setInput("");
    setAttachments([]);
    setAttachError("");
    setSending(true);
    try {
      appendReply(await postChat({ message: text, history, images: photos.map(({ name, type, data }) => ({ name, type, data })) }));
    } catch (error) {
      appendError(error, "AI 暫時無法回應");
    } finally {
      setSending(false);
    }
  };

  /** 使用者對確認單按了「確認執行」或「取消」 */
  const decide = async (messageId: number, pending: Pending, approve: boolean) => {
    if (sending) return;
    const mark = (state: PendingState) => setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pendingState: state } : m)));
    if (!approve) {
      mark("cancelled");
      setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: "已取消，沒有變更任何資料。" }]);
      return;
    }
    mark("running");
    setSending(true);
    try {
      const body = await postChat({ confirm: pending.token, approve: true });
      mark("approved");
      appendReply(body);
    } catch (error) {
      // 沒辦法確定有沒有做完：不讓使用者再按一次同一張確認單，請他到頁面上確認
      mark("approved");
      appendError(error, "執行時發生問題，請到對應的頁面確認資料有沒有變動。");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col rounded-xl border bg-card" data-testid="ai-chat">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 text-center">
            <Sparkles className="h-8 w-8 text-primary" />
            <div>
              <p className="text-lg font-semibold">想做什麼，直接說</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEmployee
                  ? "報銷、請假、查自己的出勤與薪資單，都在這裡說就可以。報銷請按左下角的相機，拍收據或選照片。送出前我會先列出來給你按確認。"
                  : "查營運數字、開報價單與訂單、新增客戶與品項、報銷、登記請假、寫月報，都在這裡說就可以。也可以按左下角的相機傳收據或單據照片。會改到資料的動作，我會先列出來給你按確認。"}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => (suggestion.includes("相機") ? fileInput.current?.click() : void send(suggestion))} className="min-h-11 rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[92%] rounded-2xl px-4 py-2.5 text-sm md:max-w-[80%]",
              message.role === "user" ? "bg-primary text-primary-foreground" : message.failed ? "border border-destructive/40 bg-destructive/5" : "bg-muted",
            )}>
              {message.role === "assistant" && message.answer && TOOL_LABELS[message.answer.tool] && (
                <p className="mb-1.5 text-xs text-muted-foreground">{TOOL_LABELS[message.answer.tool]}</p>
              )}
              {message.role === "assistant" && !!message.answer?.steps?.length && (
                <details className="mb-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">我做了 {message.answer.steps.length} 件事</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {message.answer.steps.map((step, index) => <li key={index}>{step}</li>)}
                  </ul>
                </details>
              )}
              {!!message.photos?.length && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {message.photos.map((src, index) => <img key={index} src={src} alt={`附圖 ${index + 1}`} className="h-20 w-20 rounded-lg object-cover" />)}
                </div>
              )}
              <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
              {message.answer?.table && <AnswerTable table={message.answer.table} />}
              {message.pending && (
                <PendingCard pending={message.pending} state={message.pendingState} onDecide={(approve) => void decide(message.id, message.pending!, approve)} />
              )}
              {message.answer?.download && (
                <a href={message.answer.download.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  <Download className="h-4 w-4" />{message.answer.download.label}
                </a>
              )}
              {message.answer?.link && (
                <Link href={message.answer.link.path} className="mt-1 flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {message.answer.link.label}<ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />處理中，步驟多的時候會久一點…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {(attachments.length > 0 || attachError) && (
        <div className="border-t px-3 pt-2">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((photo, index) => (
                <div key={index} className="relative">
                  {photo.preview
                    ? <img src={photo.preview} alt={photo.name} className="h-16 w-16 rounded-lg border object-cover" />
                    : <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted px-1 text-center text-[10px] text-muted-foreground">{photo.name.slice(0, 18)}</div>}
                  <button
                    type="button" aria-label={`移除 ${photo.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachError && <p className="mt-1 text-xs text-destructive">{attachError}</p>}
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => { event.preventDefault(); void send(input); }}
      >
        <input
          ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
          onChange={(event) => void addFiles(event.target.files)} data-testid="ai-chat-file"
        />
        <Button
          type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" title="拍照或選照片（收據、單據）" aria-label="拍照或選照片"
          onClick={() => fileInput.current?.click()} disabled={sending || attachments.length >= MAX_PHOTOS} data-testid="ai-chat-attach"
        >
          <Camera className="h-5 w-5" />
        </Button>
        {messages.length > 0 && (
          <Button type="button" variant="ghost" size="icon" title="清除對話，重新開始" onClick={() => setMessages([])} disabled={sending}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter 送出、Shift+Enter 換行；輸入法選字中不送出
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); }
          }}
          rows={1}
          maxLength={2000}
          placeholder="輸入訊息"
          className="max-h-40 min-h-10 flex-1 resize-none"
          data-testid="ai-chat-input"
        />
        <Button type="submit" className="min-h-11" disabled={sending || (!input.trim() && attachments.length === 0)} data-testid="ai-chat-send">
          <Send className="mr-1.5 h-4 w-4" />送出
        </Button>
      </form>
    </div>
  );
}
