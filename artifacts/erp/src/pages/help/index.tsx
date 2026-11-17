import { useMemo, useState, useRef, useEffect } from "react";
import { marked } from "marked";
import {
  Search, BookOpen, ShoppingCart, Truck, Package, FolderKanban,
  Headphones, Factory, Users, Landmark, BarChart3, Sparkles, Settings, X,
} from "lucide-react";

// 以 raw 文字載入所有說明文件
const rawDocs = import.meta.glob("../../docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

interface DocMeta { id: string; title: string; icon: React.ReactNode; content: string }

const ICONS: Record<string, React.ReactNode> = {
  "01-getting-started": <BookOpen size={16} />,
  "02-sales": <ShoppingCart size={16} />,
  "03-purchasing": <Truck size={16} />,
  "04-inventory": <Package size={16} />,
  "05-projects-contracts": <FolderKanban size={16} />,
  "06-helpdesk": <Headphones size={16} />,
  "07-assets-mfg-quality": <Factory size={16} />,
  "08-hr": <Users size={16} />,
  "09-accounting": <Landmark size={16} />,
  "10-reports": <BarChart3 size={16} />,
  "11-ai": <Sparkles size={16} />,
  "12-system": <Settings size={16} />,
};

const docs: DocMeta[] = Object.entries(rawDocs)
  .map(([path, content]) => {
    const id = path.split("/").pop()!.replace(/\.md$/, "");
    const title = (content.match(/^#\s+(.+)$/m)?.[1] || id).trim();
    return { id, title, icon: ICONS[id] ?? <BookOpen size={16} />, content };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

interface SearchHit { docId: string; docTitle: string; heading: string; snippet: string }

function buildSections(doc: DocMeta): { heading: string; body: string }[] {
  const lines = doc.content.split("\n");
  const sections: { heading: string; body: string }[] = [];
  let current = { heading: doc.title, body: "" };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current.body.trim()) sections.push(current);
      current = { heading: m[1].trim(), body: "" };
    } else {
      current.body += line + "\n";
    }
  }
  if (current.body.trim()) sections.push(current);
  return sections;
}

function searchDocs(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    for (const sec of buildSections(doc)) {
      const plain = sec.body.replace(/[#>*`|\-]/g, " ").replace(/\s+/g, " ").trim();
      const hay = (sec.heading + " " + plain).toLowerCase();
      const idx = hay.indexOf(q);
      if (idx >= 0) {
        const pIdx = plain.toLowerCase().indexOf(q);
        const start = Math.max(0, (pIdx >= 0 ? pIdx : 0) - 30);
        const snippet = (start > 0 ? "…" : "") + plain.slice(start, start + 90) + (plain.length > start + 90 ? "…" : "");
        hits.push({ docId: doc.id, docTitle: doc.title, heading: sec.heading, snippet });
      }
      if (hits.length >= 30) return hits;
    }
  }
  return hits;
}

export default function HelpCenter() {
  const [activeId, setActiveId] = useState(docs[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const active = docs.find(d => d.id === activeId) ?? docs[0];
  const html = useMemo(() => (active ? marked.parse(active.content, { async: false }) as string : ""), [active]);
  const hits = useMemo(() => searchDocs(query), [query]);

  // 從搜尋結果點入後，捲動到對應章節
  useEffect(() => {
    if (!pendingHeading || !contentRef.current) return;
    const target = Array.from(contentRef.current.querySelectorAll("h1, h2")).find(
      h => h.textContent?.trim() === pendingHeading
    );
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingHeading(null);
  }, [html, pendingHeading]);

  const openHit = (hit: SearchHit) => {
    setActiveId(hit.docId);
    setPendingHeading(hit.heading);
    setQuery("");
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <BookOpen className="text-primary" size={22} /> 使用說明與知識查詢
        </h1>
        <p className="text-sm text-muted-foreground mt-1">各功能模組的操作說明與流程，輸入關鍵字即可查詢。</p>
      </div>

      {/* 搜尋框 */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜尋說明內容，例如：退貨、薪資、營業稅、打卡…"
          className="w-full pl-9 pr-9 py-2.5 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          data-testid="input-help-search"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent" aria-label="清除搜尋">
            <X size={14} />
          </button>
        )}
        {query.trim() && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg max-h-80 overflow-y-auto">
            {hits.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">找不到「{query}」的相關內容</div>
            ) : (
              hits.map((h, i) => (
                <button
                  key={i}
                  onClick={() => openHit(h)}
                  className="w-full text-left px-4 py-2.5 hover:bg-accent border-b last:border-b-0"
                  data-testid={`help-hit-${i}`}
                >
                  <div className="text-xs text-muted-foreground">{h.docTitle} › {h.heading}</div>
                  <div className="text-sm truncate">{h.snippet}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* 目錄：手機為橫向膠囊列，桌機為左側清單 */}
        <nav className="md:w-56 shrink-0">
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-1 px-1">
            {docs.map(doc => (
              <button
                key={doc.id}
                onClick={() => { setActiveId(doc.id); contentRef.current?.scrollIntoView(); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                  doc.id === active?.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"
                }`}
                data-testid={`help-nav-${doc.id}`}
              >
                {doc.icon}
                {doc.title}
              </button>
            ))}
          </div>
        </nav>

        {/* 內容 */}
        <div ref={contentRef} className="flex-1 min-w-0 rounded-lg border bg-card p-4 md:p-8 scroll-mt-20">
          <article
            className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-table:text-sm prose-pre:bg-muted prose-pre:text-foreground"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
