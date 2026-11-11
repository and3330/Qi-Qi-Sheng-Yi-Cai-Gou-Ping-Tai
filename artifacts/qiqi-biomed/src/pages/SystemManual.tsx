import { useEffect, useMemo, useState } from "react";
import { Link, Redirect } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpen, Printer, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import manualSource from "@/content/system-manual.md?raw";

/**
 * 系統說明書（站內頁面，/manual）。
 * 內容來自 src/content/system-manual.md，改說明書只要改那個檔案再重新部署。
 * 只有內部人員看得到：後台角色（系統管理員／營運／客服）或有 ERP 角色的帳號。
 * 「系統設定」一章只給系統管理員看。
 */
const ADMIN_ONLY_HEADING = "系統設定";

type Section = { id: string; title: string; body: string };

function parseManual(source: string): { title: string; intro: string; sections: Section[] } {
  const parts = source.replace(/\r\n/g, "\n").split(/\n(?=## )/);
  const head = parts.shift() ?? "";
  const headLines = head.split("\n");
  const title = (headLines.shift() ?? "").replace(/^#\s*/, "").trim();
  const sections = parts.map((part, index) => {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).replace(/^##\s*/, "").trim();
    return {
      id: `sec-${index + 1}`,
      title: heading,
      body: newline === -1 ? "" : part.slice(newline + 1).trim(),
    };
  });
  return { title, intro: headLines.join("\n").trim(), sections };
}

function Denied() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-muted/40 px-6 text-center">
      <div className="rounded-2xl bg-destructive/10 p-4 text-destructive">
        <ShieldX size={32} />
      </div>
      <div>
        <p className="text-lg font-bold" data-testid="text-manual-denied">
          系統說明書僅供內部人員閱讀
        </p>
        <p className="mt-1 text-sm text-muted-foreground">如需開通，請聯繫系統管理員。</p>
      </div>
      <Link href="/">
        <Button data-testid="button-manual-back-home">回到首頁</Button>
      </Link>
    </div>
  );
}

export default function SystemManual() {
  const { isLoaded, isSignedIn, me } = useAuth();
  const manual = useMemo(() => parseManual(manualSource), []);
  const [activeId, setActiveId] = useState("sec-1");

  const meAny = me as (typeof me & { erpRole?: string | null }) | undefined;
  const isAdmin = meAny?.role === "admin";
  const isBackOffice = !!meAny?.role && meAny.role !== "member";
  const canRead = isBackOffice || !!meAny?.erpRole;

  const sections = useMemo(
    () => manual.sections.filter((s) => isAdmin || !s.title.includes(ADMIN_ONLY_HEADING)),
    [manual, isAdmin],
  );

  useEffect(() => {
    document.title = `${manual.title}｜七期生醫`;
  }, [manual.title]);

  // 捲動時標出目前讀到哪一章
  useEffect(() => {
    if (!canRead) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections, canRead]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (!canRead) return <Denied />;

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  return (
    <div className="min-h-[100dvh] bg-muted/30 print:bg-white">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <BookOpen className="size-5 shrink-0 text-primary" />
          <h1 className="min-w-0 flex-1 truncate text-base font-bold" data-testid="text-manual-title">
            {manual.title}
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            data-testid="button-manual-print"
          >
            <Printer className="size-4 sm:mr-1.5" />
            <span className="hidden sm:inline">列印／存成 PDF</span>
          </Button>
          {isBackOffice ? (
            <Link href="/admin">
              <Button variant="ghost" size="sm" data-testid="link-manual-admin">
                <ArrowLeft className="size-4 sm:mr-1.5" />
                <span className="hidden sm:inline">管理後台</span>
              </Button>
            </Link>
          ) : (
            <a href="/erp/">
              <Button variant="ghost" size="sm" data-testid="link-manual-erp">
                <ArrowLeft className="size-4 sm:mr-1.5" />
                <span className="hidden sm:inline">回到 ERP</span>
              </Button>
            </a>
          )}
        </div>
        {/* 手機：章節用下拉選單切換 */}
        <div className="border-t px-4 py-2 lg:hidden">
          <select
            aria-label="跳到章節"
            value={activeId}
            onChange={(e) => goTo(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="select-manual-section"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-6 print:block print:max-w-none print:p-0">
        <aside className="hidden w-56 shrink-0 lg:block print:hidden">
          <nav className="sticky top-20 flex flex-col gap-0.5" aria-label="章節">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id)}
                className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeId === s.id
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`button-manual-toc-${s.id}`}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <article className="rounded-2xl border bg-background p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
            <h1 className="hidden text-2xl font-bold print:block">{manual.title}</h1>
            {manual.intro && <p className="text-sm text-muted-foreground">{manual.intro}</p>}
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-32 lg:scroll-mt-20">
                <div
                  className="prose prose-sm max-w-none sm:prose-base prose-headings:scroll-mt-24 prose-h2:mt-10 prose-h2:border-b prose-h2:pb-2 prose-table:block prose-table:overflow-x-auto prose-th:whitespace-nowrap prose-code:before:content-none prose-code:after:content-none prose-pre:whitespace-pre-wrap prose-pre:break-all print:prose-table:table"
                >
                  <h2>{s.title}</h2>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                </div>
              </section>
            ))}
          </article>
        </main>
      </div>
    </div>
  );
}
