import { useState } from "react";
import { Link } from "wouter";
import { Search, ChevronRight, FileText, HelpCircle } from "lucide-react";
import { useListArticles } from "@workspace/api-client-react";
import { classNames } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function KnowledgePage() {
  const [tab, setTab] = useState<"article" | "faq">("article");
  const [search, setSearch] = useState("");
  
  const { data: articles, isLoading } = useListArticles({
    kind: tab,
    search: search || undefined
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      <div className="sticky top-0 z-30 bg-primary px-4 pt-safe pb-4 shadow-md">
        <h1 className="text-white font-bold text-center text-lg mb-4">知識專區</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input 
            type="search" 
            placeholder="搜尋文章或問題" 
            className="w-full bg-white border-0 pl-10 h-10 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b shadow-sm sticky top-[108px] z-30 flex">
        <button
          onClick={() => setTab("article")}
          className={classNames(
            "flex-1 py-2 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2",
            tab === "article" ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-900"
          )}
        >
          <FileText size={16} /> 衛教文章
        </button>
        <button
          onClick={() => setTab("faq")}
          className={classNames(
            "flex-1 py-2 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2",
            tab === "faq" ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-900"
          )}
        >
          <HelpCircle size={16} /> 常見問題
        </button>
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))
        ) : articles?.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>沒有找到符合條件的內容</p>
          </div>
        ) : tab === "article" ? (
          <div className="space-y-3">
            {articles?.map(article => (
              <Link key={article.id} href={`/knowledge/${article.id}`} className="block bg-white rounded-2xl p-3 shadow-sm border border-gray-100 hover-elevate">
                <div className="flex gap-3">
                  <div className="w-24 h-24 bg-gray-100 rounded-xl overflow-hidden shrink-0">
                    {article.imageUrl && <img loading="lazy" decoding="async" src={article.imageUrl} alt={article.title} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col py-1">
                    <div className="text-[10px] text-primary font-bold mb-1">{article.category}</div>
                    <h3 className="font-bold text-sm text-gray-900 leading-snug line-clamp-2 mb-1">{article.title}</h3>
                    <p className="text-xs text-gray-500 line-clamp-1 mb-auto">{article.summary}</p>
                    <div className="text-[10px] text-gray-400 mt-2">{new Date(article.publishedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4">
            <Accordion type="single" collapsible className="w-full">
              {articles?.map((faq, i) => (
                <AccordionItem key={faq.id} value={`item-${faq.id}`} className={i === (articles.length-1) ? "border-0" : ""}>
                  <AccordionTrigger className="text-sm font-bold text-left hover:no-underline py-4">
                    {faq.title}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-gray-600 leading-relaxed pb-4">
                    {faq.content || faq.summary}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </div>
    </div>
  );
}
