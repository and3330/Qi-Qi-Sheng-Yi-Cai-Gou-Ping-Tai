import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetSupportConversations, 
  useGetSupportMessages, 
  useCreateSupportConversation,
  useSendSupportMessage,
  getGetSupportMessagesQueryKey,
  type SupportConversation,
  type ChatMessage 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Send, User, Bot, Headphones, ArrowLeft, Loader2 } from "lucide-react";
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

export default function SupportPage() {
  const { me } = useAuth();
  const { toast } = useToast();
  
  // Queries
  const { data: conversations, refetch: refetchConvs, isLoading: loadingConvs } = useGetSupportConversations();
  
  // Get active conversation: either the most recent active one, or create one if none
  const activeConv = conversations?.[0]; // backend sorts by latest usually, but wait, API doesn't specify. Assuming index 0 is latest.
  const activeConvId = activeConv?.id;
  
  const createConv = useCreateSupportConversation();
  
  // If there are no conversations at all after loading, we might need to create one, or just wait for the user to send the first message.
  // Wait, if no activeConvId, we can't fetch messages. Let's auto-create one if empty, or lazily create on first send.
  // The API allows GET /support/conversations. If empty, we can just say "Hi, how can I help?" locally, then create on first message.
  // BUT to be safe, let's create it if empty.
  
  useEffect(() => {
    if (!loadingConvs && conversations && conversations.length === 0) {
      createConv.mutate(undefined, {
        onSuccess: () => refetchConvs()
      });
    }
  }, [loadingConvs, conversations]);

  // Is this conversation waiting for human?
  const needsHuman = activeConv?.needsHuman;

  const { data: thread, refetch: refetchMessages } = useGetSupportMessages(activeConvId!, {
    query: { 
      enabled: !!activeConvId, 
      refetchInterval: needsHuman ? 10000 : false, // Poll every 10s if waiting for human
      queryKey: getGetSupportMessagesQueryKey(activeConvId!)
    }
  });

  const messages = thread?.messages;

  const sendMsg = useSendSupportMessage();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMsg.isPending]);

  const handleSend = async () => {
    if (!input.trim() || !activeConvId) return;
    const text = input.trim();
    setInput("");
    
    try {
      await sendMsg.mutateAsync({ id: activeConvId, data: { content: text } });
      await refetchMessages();
      await refetchConvs(); // to update needsHuman status
    } catch (e: any) {
      toast({ title: "發送失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
      setInput(text);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav-offset">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <Link href="/member" className="p-2 text-gray-900 hover:text-primary transition-colors -ml-2">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-gray-900 font-bold text-lg tracking-wide flex items-center gap-2">
          <Headphones size={20} className="text-primary" />
          線上客服
        </h1>
        <div className="w-8" />
      </div>

      {needsHuman && (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center gap-2 text-amber-700 text-xs">
          <Loader2 size={12} className="animate-spin" />
          已為您轉接真人客服，將盡快回覆
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex gap-3 max-w-[85%]">
          <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
            <Bot size={16} />
          </div>
          <div className="bg-white border text-gray-900 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm shadow-sm">
            您好！我是七期生醫 AI 客服助理，請問有什麼我可以幫您的嗎？
          </div>
        </div>

        {messages?.map((msg: ChatMessage) => {
          const isUser = msg.role === 'user';
          const isAgent = msg.role === 'agent';
          const isAi = msg.role === 'assistant';
          
          const hasSources = !!(msg.metadata?.sources && Array.isArray(msg.metadata.sources) && msg.metadata.sources.length > 0);

          return (
            <div key={msg.id} className={`flex gap-3 max-w-[85%] ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                isUser ? 'bg-primary text-white' : 
                isAi ? 'bg-primary/20 text-primary' : 
                'bg-amber-100 text-amber-600'
              }`}>
                {isUser ? <User size={16} /> : isAi ? <Bot size={16} /> : <Headphones size={16} />}
              </div>
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} min-w-0`}>
                <div className="flex items-baseline gap-2 mb-1 px-1">
                  <span className="text-[10px] font-medium text-gray-500">
                    {isUser ? '您' : isAi ? 'AI 助理' : '客服人員'}
                  </span>
                </div>
                <div className={`px-4 py-2.5 rounded-2xl max-w-full text-sm shadow-sm ${
                  isUser ? 'bg-primary text-white rounded-tr-sm' : 
                  isAgent ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-tl-sm' :
                  'bg-white border text-gray-900 rounded-tl-sm'
                }`}>
                  {isUser ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <SimpleMarkdown content={msg.content} />
                  )}
                </div>
                {hasSources ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(msg.metadata!.sources as any[]).map((src: any, idx: number) => (
                      <span key={idx} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border">
                        參考：{src.title || src.name || '相關資料'}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {sendMsg.isPending && (
          <div className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="bg-white border text-gray-500 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm shadow-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              輸入中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t p-3 pb-safe">
        <form 
          className="relative flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        >
          <div className="flex-1 bg-gray-50 border rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all flex items-center">
            <input
              className="w-full bg-transparent border-0 outline-none text-sm min-h-[24px] py-1"
              placeholder="輸入訊息..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sendMsg.isPending || !activeConvId}
            />
          </div>
          <Button 
            type="submit" 
            size="icon" 
            className="rounded-full h-10 w-10 shrink-0" 
            disabled={!input.trim() || sendMsg.isPending || !activeConvId}
          >
            <Send size={18} />
          </Button>
        </form>
        <div className="text-center text-[10px] text-gray-400 mt-2 pb-1">
          本服務不提供醫療診斷，用藥請諮詢醫師
        </div>
      </div>
    </div>
  );
}