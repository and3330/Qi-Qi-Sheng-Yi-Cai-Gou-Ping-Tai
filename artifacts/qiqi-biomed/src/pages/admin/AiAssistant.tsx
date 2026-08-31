import { useState, useRef, useEffect } from "react";
import { 
  useGetAssistantConversations, 
  useGetAssistantMessages, 
  useCreateAssistantConversation, 
  useSendAssistantMessage, 
  useConfirmAssistantAction,
  useRebuildAiIndex,
  getGetAssistantMessagesQueryKey,
  type AssistantConversation,
  type ChatMessage 
} from "@workspace/api-client-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Send, Bot, Database, Loader2, Sparkles, MessageSquare, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// A simple markdown renderer for bold, lists, and tables (no large libraries)
function SimpleMarkdown({ content }: { content: string }) {
  // Split into lines
  const lines = content.split('\n');
  const elements = [];
  
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const renderText = (text: string) => {
    // Bold **text**
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const flushTable = (key: number) => {
    if (!inTable || tableHeaders.length === 0) return null;
    const el = (
      <div key={`table-${key}`} className="my-4 w-full overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              {tableHeaders.map((th, i) => (
                <th key={i} className="px-4 py-2 text-left font-medium text-muted-foreground">{renderText(th)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {tableRows.map((tr, i) => (
              <tr key={i} className="hover:bg-muted/30">
                {tr.map((td, j) => (
                  <td key={j} className="px-4 py-2">{renderText(td)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableHeaders = [];
    tableRows = [];
    inTable = false;
    return el;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Table processing
    if (line.trim().startsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (lines[i+1]?.trim().match(/^\|[-\s:|]+\|$/)) {
        // It's a header
        tableHeaders = cells;
        i++; // skip separator
        continue;
      } else {
        tableRows.push(cells);
        continue;
      }
    } else if (inTable) {
      const table = flushTable(i);
      if (table) elements.push(table);
    }

    // List item
    if (line.trim().match(/^-\s/)) {
      elements.push(<li key={i} className="ml-4 list-disc my-1">{renderText(line.trim().slice(2))}</li>);
    } else if (line.trim().match(/^\d+\.\s/)) {
      const match = line.trim().match(/^(\d+\.)\s(.*)/);
      elements.push(<li key={i} className="ml-4 list-decimal my-1">{renderText(match?.[2] || '')}</li>);
    } 
    // Heading 3
    else if (line.trim().startsWith('### ')) {
      elements.push(<h3 key={i} className="text-lg font-bold mt-4 mb-2">{renderText(line.trim().slice(4))}</h3>);
    }
    // Heading 2
    else if (line.trim().startsWith('## ')) {
      elements.push(<h2 key={i} className="text-xl font-bold mt-5 mb-2">{renderText(line.trim().slice(3))}</h2>);
    }
    // Heading 1
    else if (line.trim().startsWith('# ')) {
      elements.push(<h1 key={i} className="text-2xl font-bold mt-6 mb-3">{renderText(line.trim().slice(2))}</h1>);
    }
    else {
      // Normal text
      if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(<p key={i} className="my-1">{renderText(line)}</p>);
      }
    }
  }

  // Flush remaining table
  if (inTable) {
    const table = flushTable(lines.length);
    if (table) elements.push(table);
  }

  return <div className="text-sm leading-relaxed">{elements}</div>;
}

export default function AdminAiAssistantPage() {
  const { me } = useAuth();
  const { toast } = useToast();
  
  // Queries
  const { data: conversations, refetch: refetchConvs } = useGetAssistantConversations();
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  
  // Set default active if not set
  useEffect(() => {
    if (conversations && conversations.length > 0 && activeConvId === null) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  const { data: messages, refetch: refetchMessages } = useGetAssistantMessages(activeConvId!, {
    query: { enabled: !!activeConvId, queryKey: getGetAssistantMessagesQueryKey(activeConvId!) }
  });

  const createConv = useCreateAssistantConversation();
  const sendMsg = useSendAssistantMessage();
  const confirmAction = useConfirmAssistantAction();
  const rebuildIndex = useRebuildAiIndex();

  const [input, setInput] = useState("");
  const [confirmedActionIds, setConfirmedActionIds] = useState<Set<number>>(
    () => new Set(),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCreateNew = async () => {
    try {
      const conv = await createConv.mutateAsync({});
      await refetchConvs();
      setActiveConvId(conv.id);
    } catch (e: any) {
      toast({ title: "建立失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConvId) return;
    const text = input.trim();
    setInput("");
    
    try {
      await sendMsg.mutateAsync({ id: activeConvId, data: { content: text } });
      await refetchMessages();
    } catch (e: any) {
      toast({ title: "發送失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
      setInput(text);
    }
  };

  const handleRebuild = async () => {
    try {
      const res = await rebuildIndex.mutateAsync();
      toast({ 
        title: "知識庫重建完成", 
        description: `商品: ${(res.counts as any)?.product || 0} 筆, 文章: ${(res.counts as any)?.article || 0} 筆` 
      });
    } catch (e: any) {
      toast({ title: "重建失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const handleConfirmAction = async (actionId: number) => {
    if (!activeConvId || confirmedActionIds.has(actionId)) return;
    try {
      await confirmAction.mutateAsync({ id: activeConvId, actionId });
      setConfirmedActionIds((previous) => new Set(previous).add(actionId));
      await refetchMessages();
    } catch (e: any) {
      toast({
        title: "確認失敗",
        description: e?.data?.error || "操作可能已確認、已執行或逾時，請重新提出。",
        variant: "destructive",
      });
    }
  };

  return (
    <AdminLayout title="AI 行政助理">
      <div className="flex h-[calc(100vh-120px)] border bg-white rounded-2xl overflow-hidden shadow-sm">
        {/* Sidebar */}
        <div className="w-64 border-r flex flex-col bg-gray-50/50 shrink-0">
          <div className="p-4 border-b">
            <Button onClick={handleCreateNew} className="w-full rounded-xl gap-2 h-10" disabled={createConv.isPending}>
              {createConv.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              新對話
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations?.map((conv: AssistantConversation) => (
              <button
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 truncate ${
                  activeConvId === conv.id 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <MessageSquare size={14} className="shrink-0" />
                <span className="truncate">{conv.title}</span>
              </button>
            ))}
            {!conversations?.length && (
              <div className="text-center text-xs text-muted-foreground p-4">尚無對話紀錄</div>
            )}
          </div>
          {me?.role === "admin" && (
            <div className="p-4 border-t bg-gray-50">
              <Button 
                variant="outline" 
                className="w-full text-xs h-8" 
                onClick={handleRebuild}
                disabled={rebuildIndex.isPending}
              >
                <Database size={14} className="mr-2" />
                {rebuildIndex.isPending ? "重建中..." : "重建知識庫索引"}
              </Button>
            </div>
          )}
        </div>

        {/* Main Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {!activeConvId ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Bot size={48} className="mb-4 opacity-50" />
                <p>請選擇或建立新的對話</p>
              </div>
            ) : (
              <>
                {messages?.map((msg: ChatMessage) => {
                  const isUser = msg.role === 'user';
                  const tools = Array.isArray(msg.metadata?.tools)
                    ? (msg.metadata.tools as Array<{
                        tool?: string;
                        isAction?: boolean;
                        isError?: boolean;
                        status?: "pending" | "executed";
                        confirmationId?: number;
                      }>)
                    : [];
                  const pendingActions = tools.filter(
                    (tool) =>
                      tool.isAction &&
                      !tool.isError &&
                      tool.status === "pending" &&
                      typeof tool.confirmationId === "number",
                  );
                  const hasExecutedAction = tools.some(
                    (tool) =>
                      tool.isAction && !tool.isError && tool.status === "executed",
                  );
                  
                  return (
                    <div key={msg.id} className={`flex gap-4 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-primary text-primary-foreground' : 'bg-blue-100 text-blue-600'}`}>
                        {isUser ? me?.name?.[0] || 'U' : <Bot size={16} />}
                      </div>
                      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} min-w-0`}>
                        <div className={`px-4 py-3 rounded-2xl max-w-full ${isUser ? 'bg-primary text-white rounded-tr-sm' : 'bg-gray-100 text-gray-900 rounded-tl-sm'}`}>
                          {isUser ? (
                            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                          ) : (
                            <SimpleMarkdown content={msg.content} />
                          )}
                        </div>
                        {pendingActions.map((action) => {
                          const actionId = action.confirmationId!;
                          const confirmed = confirmedActionIds.has(actionId);
                          return (
                            <Button
                              key={actionId}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2 gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                              onClick={() => handleConfirmAction(actionId)}
                              disabled={
                                confirmed ||
                                confirmAction.isPending ||
                                sendMsg.isPending
                              }
                              data-testid={`button-confirm-assistant-action-${actionId}`}
                            >
                              {confirmAction.isPending ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <ShieldCheck size={13} />
                              )}
                              {confirmed
                                ? "已確認並執行"
                                : `確認執行 ${action.tool ?? "此操作"}`}
                            </Button>
                          );
                        })}
                        {hasExecutedAction ? (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <Sparkles size={10} /> 已執行操作
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {sendMsg.isPending && (
                  <div className="flex gap-4 max-w-3xl">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      <Bot size={16} />
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-gray-100 text-gray-500 rounded-tl-sm text-sm flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      思考中...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
          
          {activeConvId && (
            <div className="p-4 border-t bg-white">
              <form 
                className="relative flex items-end gap-2 max-w-3xl mx-auto"
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              >
                <div className="flex-1 bg-gray-50 border rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all flex items-center">
                  <input
                    className="w-full bg-transparent border-0 outline-none text-sm min-h-[24px] py-1"
                    placeholder="輸入指令，例如：幫我查庫存低於 10 的保健食品..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={sendMsg.isPending}
                  />
                </div>
                <Button 
                  type="submit" 
                  size="icon" 
                  className="rounded-full h-10 w-10 shrink-0" 
                  disabled={!input.trim() || sendMsg.isPending}
                >
                  <Send size={18} />
                </Button>
              </form>
              <div className="text-center text-[10px] text-muted-foreground mt-2">
                AI 回覆可能包含錯誤資訊，執行重要操作前請確認。
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}