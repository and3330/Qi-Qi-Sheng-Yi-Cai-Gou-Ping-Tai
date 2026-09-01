import React, { useState, useEffect, useRef } from 'react';
import { 
  useGetAssistantConversations, 
  useGetAssistantMessages, 
  useCreateAssistantConversation, 
  useSendAssistantMessage, 
  useConfirmAssistantAction,
  getGetAssistantMessagesQueryKey,
  type ChatMessage
} from '@workspace/api-client-react';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Bot, Send, Loader2, Sparkles, ShieldCheck, Lock, ExternalLink } from 'lucide-react';

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements = [];
  
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const renderText = (text: string) => {
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
      <div key={`table-${key}`} className="my-3 w-full overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 border-b">
            <tr>
              {tableHeaders.map((th, i) => (
                <th key={i} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{renderText(th)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {tableRows.map((tr, i) => (
              <tr key={i} className="hover:bg-muted/30">
                {tr.map((td, j) => (
                  <td key={j} className="px-3 py-1.5 whitespace-nowrap">{renderText(td)}</td>
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
    
    if (line.trim().startsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (lines[i+1]?.trim().match(/^\|[-\s:|]+\|$/)) {
        tableHeaders = cells;
        i++;
        continue;
      } else {
        tableRows.push(cells);
        continue;
      }
    } else if (inTable) {
      const table = flushTable(i);
      if (table) elements.push(table);
    }

    if (line.trim().match(/^-\s/)) {
      elements.push(<li key={i} className="ml-4 list-disc my-0.5">{renderText(line.trim().slice(2))}</li>);
    } else if (line.trim().match(/^\d+\.\s/)) {
      const match = line.trim().match(/^(\d+\.)\s(.*)/);
      elements.push(<li key={i} className="ml-4 list-decimal my-0.5">{renderText(match?.[2] || '')}</li>);
    } 
    else if (line.trim().startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm font-bold mt-3 mb-1">{renderText(line.trim().slice(4))}</h3>);
    }
    else if (line.trim().startsWith('## ')) {
      elements.push(<h2 key={i} className="text-base font-bold mt-4 mb-1">{renderText(line.trim().slice(3))}</h2>);
    }
    else if (line.trim().startsWith('# ')) {
      elements.push(<h1 key={i} className="text-lg font-bold mt-4 mb-2">{renderText(line.trim().slice(2))}</h1>);
    }
    else {
      if (line.trim() === '') {
        elements.push(<div key={i} className="h-1" />);
      } else {
        elements.push(<p key={i} className="my-0.5">{renderText(line)}</p>);
      }
    }
  }

  if (inTable) {
    const table = flushTable(lines.length);
    if (table) elements.push(table);
  }

  return <div className="text-sm leading-relaxed">{elements}</div>;
}

export function AiAssistantWidget() {
  const { user } = useErpAuth();
  
  if (user?.role !== 'admin' && user?.role !== 'ops') {
    return (
      <Card className="shadow-sm border-t-4 border-t-primary bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            跨系統 AI 營運助手
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground space-y-3">
            <Lock className="w-8 h-8 opacity-50" />
            <p className="text-sm">您的權限等級無法使用 AI 營運助手功能，請聯繫系統管理員。</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <AiAssistantActive />;
}

function AiAssistantActive() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: conversations, refetch: refetchConvs } = useGetAssistantConversations();
  const [activeConvId, setActiveConvId] = useState<number | null>(null);

  useEffect(() => {
    if (conversations && conversations.length > 0 && activeConvId === null) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  const { data: messages, refetch: refetchMessages } = useGetAssistantMessages(activeConvId || 0, {
    query: { enabled: !!activeConvId, queryKey: getGetAssistantMessagesQueryKey(activeConvId || 0) }
  });

  const createConv = useCreateAssistantConversation();
  const sendMsg = useSendAssistantMessage();
  const confirmAction = useConfirmAssistantAction();

  const [input, setInput] = useState("");
  const [confirmedActionIds, setConfirmedActionIds] = useState<Set<number>>(() => new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (textOverride?: string) => {
    const text = (typeof textOverride === 'string' ? textOverride : input).trim();
    if (!text) return;
    
    setInput("");
    
    try {
      let currentConvId = activeConvId;
      if (!currentConvId) {
        const conv = await createConv.mutateAsync({});
        currentConvId = conv.id;
        setActiveConvId(conv.id);
        await refetchConvs();
      }
      
      await sendMsg.mutateAsync({ id: currentConvId, data: { content: text } });
      await queryClient.invalidateQueries({
        queryKey: getGetAssistantMessagesQueryKey(currentConvId),
      });
    } catch (e: any) {
      toast({ title: "發送失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
      if (typeof textOverride !== 'string') setInput(text);
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

  const exampleQueries = [
    "請幫我查上個月的營收狀況",
    "目前有哪些庫存低於安全庫存的商品？",
    "有哪些訂單還在等待出貨？"
  ];

  return (
    <Card className="shadow-sm border-t-4 border-t-primary flex flex-col h-[450px]">
      <CardHeader className="pb-3 shrink-0 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            跨系統 AI 營運助手
          </CardTitle>
          <a href="/admin/ai-assistant" className="text-xs text-muted-foreground flex items-center gap-1 hover:text-primary transition-colors">
            完整對話 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {!activeConvId && !messages?.length ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-5">
            <Bot className="w-12 h-12 opacity-20" />
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {exampleQueries.map((q, i) => (
                <Button key={i} variant="outline" size="sm" className="text-xs bg-muted/30" onClick={() => handleSend(q)} disabled={sendMsg.isPending || createConv.isPending}>
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
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
                <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                    {isUser ? 'U' : <Bot size={16} />}
                  </div>
                  <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} min-w-0`}>
                    <div className={`px-4 py-2.5 rounded-2xl max-w-full text-sm ${isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted text-foreground rounded-tl-sm'}`}>
                      {isUser ? (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
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
                          className="mt-2 gap-1.5 h-8 text-xs border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                          onClick={() => handleConfirmAction(actionId)}
                          disabled={
                            confirmed ||
                            confirmAction.isPending ||
                            sendMsg.isPending
                          }
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
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <Sparkles size={11} /> 已執行操作
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {sendMsg.isPending && (
              <div className="flex gap-3 max-w-[85%]">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot size={16} />
                </div>
                <div className="px-4 py-2.5 rounded-2xl bg-muted text-muted-foreground rounded-tl-sm text-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  思考中...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </CardContent>
      <div className="p-3 border-t bg-background shrink-0">
        <form 
          className="relative flex items-center gap-2 max-w-4xl mx-auto"
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        >
          <Input
            className="flex-1 bg-muted/50 border-0 focus-visible:ring-1"
            placeholder="輸入指令，例如：幫我查庫存低於 10 的商品..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sendMsg.isPending || createConv.isPending}
          />
          <Button 
            type="submit" 
            size="icon" 
            className="shrink-0 h-10 w-10 rounded-full" 
            disabled={!input.trim() || sendMsg.isPending || createConv.isPending}
          >
            <Send size={16} />
          </Button>
        </form>
      </div>
    </Card>
  );
}
