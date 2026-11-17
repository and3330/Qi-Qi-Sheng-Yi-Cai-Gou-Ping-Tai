import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Pencil, Search, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";
import { navGroups, topLevelNavs, type NavItem } from "@/components/layout/sidebar";

type Entry = { label: string; path: string; icon: React.ReactNode; group: string; folder: string };

/** 我能開的所有功能，依選單的大分類整理（跟左邊選單同一套權限） */
function useAllEntries(): Entry[] {
  const { user } = useAuth();
  const { allowed } = useMenuAllowed();
  return useMemo(() => {
    if (user?.role === ROLE_EMPLOYEE) return [];
    const out: Entry[] = [];
    const add = (group: string, items: NavItem[]) => items.forEach(it => {
      if (!allowed(it.path, it.roles)) return;
      if (it.children) it.children.forEach(c => { if (allowed(c.path, c.roles)) out.push({ label: c.label, path: c.path, icon: c.icon, group, folder: it.label }); });
      else if (it.path) out.push({ label: it.label, path: it.path, icon: it.icon, group, folder: "" });
    });
    topLevelNavs.forEach(it => add(it.label, [it]));
    navGroups.forEach(g => add(g.groupLabel, g.items));
    return out;
  }, [user?.role, allowed]);
}

export default function MyPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const entries = useAllEntries();
  const byPath = useMemo(() => new Map(entries.map(e => [e.path, e])), [entries]);
  const { data, isLoading } = useQuery<{ paths: string[] }>({
    queryKey: ["my-shortcuts"],
    queryFn: () => fetch("/erp-api/admin/me/shortcuts", { credentials: "include" }).then(r => r.ok ? r.json() : { paths: [] }),
  });
  const mine = (data?.paths ?? []).map(p => byPath.get(p)).filter((e): e is Entry => !!e);

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    mine.forEach(e => m.set(e.group, [...(m.get(e.group) ?? []), e]));
    return [...m.entries()];
  }, [mine]);
  const [tab, setTab] = useState<string>("");
  const activeTab = groups.some(([g]) => g === tab) ? tab : groups[0]?.[0] ?? "";

  const save = useMutation({
    mutationFn: (paths: string[]) => fetch("/erp-api/admin/me/shortcuts", {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }),
    }).then(r => { if (!r.ok) throw new Error("儲存失敗"); return r.json(); }),
    onSuccess: (d) => { qc.setQueryData(["my-shortcuts"], d); toast({ title: "我的頁面已更新" }); setEditing(false); },
    onError: () => toast({ title: "儲存失敗，請再試一次", variant: "destructive" }),
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const openEdit = () => { setDraft(mine.map(e => e.path)); setQ(""); setEditing(true); };
  const toggle = (p: string) => setDraft(d => d.includes(p) ? d.filter(x => x !== p) : [...d, p]);
  const term = q.trim().toLowerCase();
  const editGroups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    entries.filter(e => !term || e.label.toLowerCase().includes(term) || e.folder.toLowerCase().includes(term))
      .forEach(e => m.set(e.group, [...(m.get(e.group) ?? []), e]));
    return [...m.entries()];
  }, [entries, term]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Star className="h-5 w-5 fill-amber-400 text-amber-400" />我的頁面</h1>
        <Button variant="outline" onClick={openEdit}><Pencil className="mr-2 h-4 w-4" />編輯常用功能</Button>
      </div>

      {!isLoading && mine.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">還沒有常用功能。把每天會用到的頁面加進來，以後一進來就點得到。</p>
          <Button className="mt-4" onClick={openEdit}>挑選常用功能</Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap gap-1 border-b p-2" role="tablist">
            {groups.map(([g, list]) => (
              <button key={g} role="tab" aria-selected={g === activeTab} onClick={() => setTab(g)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${g === activeTab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {g}<span className="ml-1 text-xs opacity-70">{list.length}</span>
              </button>
            ))}
          </div>
          <ul className="grid gap-1 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {(groups.find(([g]) => g === activeTab)?.[1] ?? []).map(e => (
              <li key={e.path}>
                <Link href={e.path} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-muted">
                  <span className="text-muted-foreground">{e.icon}</span>
                  <span className="font-medium">{e.label}</span>
                  {e.folder && <span className="ml-auto text-xs text-muted-foreground">{e.folder}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>編輯常用功能</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">勾選要放進「我的頁面」的功能，會依左邊選單的大分類分頁顯示。設定存在你的帳號上，換電腦登入也一樣。</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋功能名稱，例如：付款單" className="pl-9" />
          </div>
          <div className="space-y-4">
            {editGroups.map(([g, list]) => (
              <div key={g}>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">{g}</div>
                <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3">
                  {list.map(e => {
                    const on = draft.includes(e.path);
                    return (
                      <button key={e.path} type="button" onClick={() => toggle(e.path)} aria-pressed={on}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${on ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>{on && <Check className="h-3 w-3" />}</span>
                        <span className="truncate">{e.label}</span>
                        {e.folder && <span className="ml-auto truncate text-xs text-muted-foreground">{e.folder}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {editGroups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">找不到符合的功能</p>}
          </div>
          <DialogFooter className="gap-2">
            <span className="mr-auto self-center text-sm text-muted-foreground">已選 {draft.length} 個{draft.length >= 40 && "（最多 40 個）"}</span>
            {draft.length > 0 && <Button variant="ghost" onClick={() => setDraft([])}><X className="mr-1 h-4 w-4" />全部清掉</Button>}
            <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
            <Button onClick={() => save.mutate(draft.slice(0, 40))} disabled={save.isPending}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
