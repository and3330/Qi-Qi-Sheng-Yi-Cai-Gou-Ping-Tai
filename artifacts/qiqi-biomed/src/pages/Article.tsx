import { useRoute, Link } from "wouter";
import { ArrowLeft, Share2 } from "lucide-react";
import { useGetArticle, getGetArticleQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function ArticlePage() {
  const [, params] = useRoute("/knowledge/:id");
  const id = Number(params?.id);
  const { data: article, isLoading } = useGetArticle(id, { query: { enabled: !!id, queryKey: getGetArticleQueryKey(id) } });

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-white pb-20 pt-4 px-4 space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
        <p className="text-gray-500 mb-4">找不到文章</p>
        <Button asChild><Link href="/knowledge">返回知識專區</Link></Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-white animate-in fade-in pb-20">
      <div className="sticky top-[var(--sf-header-h,0px)] z-30 flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-md">
        <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm" onClick={() => window.history.back()}>
          <ArrowLeft size={20} />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm text-gray-600">
          <Share2 size={20} />
        </Button>
      </div>

      {article.imageUrl && (
        <div className="w-full aspect-video bg-gray-100">
          <img src={article.imageUrl} alt={article.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className={`px-5 ${article.imageUrl ? 'pt-6' : 'pt-20'} pb-10`}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-sm">
            {article.category}
          </span>
          <span className="text-xs text-gray-400 font-medium">
            {new Date(article.publishedAt).toLocaleDateString()}
          </span>
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-6">
          {article.title}
        </h1>

        <div className="prose prose-sm prose-gray max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-a:text-primary">
          {/* Extremely simple markdown rendering, as ReactMarkdown is not in package.json */}
          {article.content?.split('\n').map((line, i) => {
            if (line.startsWith('# ')) return <h1 key={i} className="text-xl mt-6 mb-3">{line.slice(2)}</h1>;
            if (line.startsWith('## ')) return <h2 key={i} className="text-lg mt-5 mb-2">{line.slice(3)}</h2>;
            if (line.startsWith('### ')) return <h3 key={i} className="text-base mt-4 mb-2">{line.slice(4)}</h3>;
            if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc my-1">{line.slice(2)}</li>;
            if (line.trim() === '') return <div key={i} className="h-4" />;
            return <p key={i} className="my-2">{line}</p>;
          })}
        </div>
      </div>
    </div>
  );
}
