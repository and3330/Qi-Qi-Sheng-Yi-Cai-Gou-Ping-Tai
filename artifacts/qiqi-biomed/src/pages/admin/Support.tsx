import { useState, useRef, useEffect } from "react";
import { 
  useGetAdminSupportConversations, 
  useGetAdminSupportMessages, 
  useReplySupportConversation,
  useCloseSupportConversation,
  getGetAdminSupportMessagesQueryKey,
  type AdminSupportConversation,
  type ChatMessage 
} from "@workspace/api-client-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Send, User, Bot, Headphones, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AdminSupportPage() {
  const { toast } = useToast();
  
  const [filter, setFilter] = useState<"needsHuman" | "all">("needsHuman");
  
  // Queries
  const { data: conversations, refetch: refetchConvs } = useGetAdminSupportConversations({
    needsHuman: filter === "needsHuman" ? "true" : undefined
  });
  
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  
  // Set default active if not set
  useEffect(() => {
    if (conversations && conversations.length > 0 && activeConvId === null) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  const { data: thread, refetch: refetchMessages } = useGetAdminSupportMessages(activeConvId!, {
    query: { enabled: !!activeConvId, refetchInterval: 10000, queryKey: getGetAdminSupportMessagesQueryKey(activeConvId!) } // Auto-poll
  });
  
  const messages = thread?.messages;

  const replyMut = useReplySupportConversation();
  const closeMut = useCloseSupportConversation();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !activeConvId) return;
    const text = input.trim();
    setInput("");
    
    try {
      await replyMut.mutateAsync({ id: activeConvId, data: { content: text } });
      await refetchMessages();
      await refetchConvs();
    } catch (e: any) {
      toast({ title: "回覆失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
      setInput(text);
    }
  };
  
  const handleClose = async () => {
    if (!activeConvId) return;
    try {
      await closeMut.mutateAsync({ id: activeConvId });
      toast({ title: "已結案" });
      await refetchMessages();
      await refetchConvs();
    } catch (e: any) {
      toast({ title: "結案失敗", description: e?.data?.error || "請稍後再試", variant: "destructive" });
    }
  };

  const activeConv = conversations?.find(c => c.id === activeConvId);

  return (
    <AdminLayout title="客服對話">
      <div className="flex h-[calc(100vh-120px)] border bg-white rounded-2xl overflow-hidden shadow-sm">
        {/* Sidebar */}
        <div className="w-64 border-r flex flex-col bg-gray-50/50 shrink-0">
          <div className="p-4 border-b">
            <Select value={filter} onValueChange={(v: "needsHuman" | "all") => setFilter(v)}>
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="needsHuman">待真人處理</SelectItem>
                <SelectItem value="all">全部對話</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations?.map((conv: AdminSupportConversation) => (
              <button
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors relative ${
                  activeConvId === conv.id 
                    ? "bg-primary/10 text-primary" 
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold truncate">{conv.memberName}</span>
                  {conv.needsHuman && (
                    <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
                  )}
                </div>
                <div className="text-xs opacity-70 truncate">
                  {conv.memberUsername}
                </div>
                {conv.status === 'closed' && (
                  <Badge variant="outline" className="text-[10px] mt-1 scale-90 origin-left">已結案</Badge>
                )}
              </button>
            ))}
            {!conversations?.length && (
              <div className="text-center text-xs text-muted-foreground p-4">尚無對話紀錄</div>
            )}
          </div>
        </div>

        {/* Main Chat */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {activeConvId && activeConv ? (
            <>
              {/* Header */}
              <div className="p-4 border-b flex items-center justify-between bg-white shadow-sm z-10">
                <div>
                  <h3 className="font-bold">{activeConv.memberName}</h3>
                  <p className="text-xs text-muted-foreground">{activeConv.memberUsername}</p>
                </div>
                {activeConv.status !== 'closed' && (
                  <Button variant="outline" size="sm" onClick={handleClose} disabled={closeMut.isPending}>
                    <CheckCircle2 size={16} className="mr-1" />
                    結案
                  </Button>
                )}
              </div>
              
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages?.map((msg: ChatMessage) => {
                  const isAgent = msg.role === 'agent';
                  const isAi = msg.role === 'assistant';
                  const isUser = msg.role === 'user';
                  
                  return (
                    <div key={msg.id} className={`flex gap-3 max-w-2xl ${isAgent ? 'ml-auto flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                        isUser ? 'bg-gray-200 text-gray-600' :
                        isAi ? 'bg-primary/20 text-primary' :
                        'bg-amber-100 text-amber-600'
                      }`}>
                        {isUser ? <User size={16} /> : isAi ? <Bot size={16} /> : <Headphones size={16} />}
                      </div>
                      <div className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'} min-w-0`}>
                        <div className="flex items-baseline gap-2 mb-1 px-1">
                          <span className="text-[11px] font-medium text-gray-500">
                            {isUser ? '會員' : isAi ? 'AI 助理' : '客服人員'}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(msg.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`px-4 py-2.5 rounded-2xl max-w-full text-sm ${
                          isUser ? 'bg-gray-100 text-gray-900 rounded-tl-sm' :
                          isAi ? 'bg-primary/5 border border-primary/20 text-gray-900 rounded-tl-sm' :
                          'bg-amber-50 border border-amber-200 text-amber-900 rounded-tr-sm'
                        }`}>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              
              {/* Input */}
              {activeConv.status !== 'closed' ? (
                <div className="p-4 border-t bg-white">
                  <form 
                    className="relative flex items-end gap-2"
                    onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                  >
                    <div className="flex-1 bg-gray-50 border rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all flex items-center">
                      <input
                        className="w-full bg-transparent border-0 outline-none text-sm min-h-[24px] py-1"
                        placeholder="回覆會員..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={replyMut.isPending}
                      />
                    </div>
                    <Button 
                      type="submit" 
                      size="icon" 
                      className="rounded-full h-10 w-10 shrink-0 bg-amber-500 hover:bg-amber-600 text-white" 
                      disabled={!input.trim() || replyMut.isPending}
                    >
                      <Send size={18} />
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="p-4 border-t bg-gray-50 text-center text-sm text-gray-500">
                  此對話已結案
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Headphones size={48} className="mb-4 opacity-50" />
              <p>請選擇左側對話以進行回覆</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}