import { useState, useEffect, useCallback } from "react";
import { payrollApi, type BracketRowInput, type InsuranceBracket } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, Heart, Landmark, ClipboardPaste, Trash2, AlertTriangle, Download } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { useToast } from "@/hooks/use-toast";
import { BRACKET_YEAR_LABEL, officialBrackets } from "@/lib/insurance-brackets-2026";

const fmt = (n: number) => `$${n.toLocaleString()}`;

const rateInfo = {
  labor: { icon: Shield, title: "勞保投保級距", label: "勞保", rate: "12.5%", employee: "20%", employer: "70%" },
  health: { icon: Heart, title: "健保投保級距", label: "健保", rate: "5.17%", employee: "30%", employer: "60%" },
  pension: { icon: Landmark, title: "勞退提繳級距", label: "勞退", rate: "6%", employee: "0-6% (自提)", employer: "6%" },
};
type BracketType = keyof typeof rateInfo;

/**
 * 解析貼上的級距表。每行一級，欄位用逗號、Tab 或空白分隔，金額可含千分位：
 *   最低薪資, 最高薪資, 投保金額   （最高薪資可留空或寫 -，代表「以上」）
 *   最低薪資, 投保金額             （只有兩欄時視為沒有上限）
 */
export function parseBracketText(text: string): { rows: BracketRowInput[]; errors: string[] } {
  const rows: BracketRowInput[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line
      .split(/[\t;]|,(?!\d{3}(?:\D|$))|\s{2,}|\s(?=[\d-])/)
      .map((c) => c.replace(/[,$\s元]/g, "").trim())
      .filter((c) => c !== "");
    const toNumber = (c: string) => (/^\d+$/.test(c) ? Number(c) : NaN);
    const isOpen = (c: string) => c === "-" || c === "—" || c === "以上";
    let min: number, max: number | null, insured: number;
    if (cells.length === 3) {
      min = toNumber(cells[0]);
      max = isOpen(cells[1]) ? null : toNumber(cells[1]);
      insured = toNumber(cells[2]);
    } else if (cells.length === 2) {
      min = toNumber(cells[0]);
      max = null;
      insured = toNumber(cells[1]);
    } else {
      errors.push(`第 ${index + 1} 行：需要 2 或 3 個欄位`);
      return;
    }
    if (Number.isNaN(min) || Number.isNaN(insured) || (max !== null && Number.isNaN(max))) {
      errors.push(`第 ${index + 1} 行：金額必須是整數`);
      return;
    }
    if (max !== null && max < min) {
      errors.push(`第 ${index + 1} 行：最高薪資不可小於最低薪資`);
      return;
    }
    rows.push({ minSalary: min, maxSalary: max, insuredAmount: insured });
  });
  return { rows, errors };
}

export default function InsuranceBracketsPage() {
  const reloadKey = useAutoReloadKey();
  const { toast } = useToast();
  const [tab, setTab] = useState<BracketType>("labor");
  const [brackets, setBrackets] = useState<InsuranceBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const batch = useBatchSelection(brackets);

  const reload = useCallback(() => {
    setLoading(true);
    payrollApi.listBrackets(tab).then(setBrackets).catch(() => setBrackets([])).finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { reload(); }, [reload, reloadKey]);
  useEffect(() => {
    payrollApi.bracketPermissions().then((p) => setCanManage(p.canManage)).catch(() => setCanManage(false));
  }, []);

  const info = rateInfo[tab];
  const parsed = parseBracketText(pasteText);

  const submitPaste = async () => {
    if (parsed.errors.length > 0 || parsed.rows.length === 0) return;
    setSaving(true);
    try {
      const result = await payrollApi.bulkReplaceBrackets(tab, parsed.rows);
      toast({ title: `已匯入 ${result.count} 級${info.label}級距` });
      setPasteOpen(false);
      setPasteText("");
      reload();
    } catch (error) {
      toast({ title: "匯入失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // 一次建立勞保、健保、勞退三張官方級距表（會取代現有的級距）
  const loadOfficial = async () => {
    if (!window.confirm(`要載入 ${BRACKET_YEAR_LABEL} 的官方投保級距嗎？
勞保、健保、勞退三張表會一次建立；現有的級距會被取代，所有公司的薪資計算都會改用新表。`)) return;
    setSaving(true);
    try {
      const counts: string[] = [];
      for (const type of ["labor", "health", "pension"] as const) {
        const result = await payrollApi.bulkReplaceBrackets(type, officialBrackets(type));
        counts.push(`${rateInfo[type].label} ${result.count} 級`);
      }
      toast({ title: "官方級距已建立", description: counts.join("、") });
      reload();
    } catch (error) {
      toast({ title: "載入失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeBracket = async (row: InsuranceBracket) => {
    if (!window.confirm(`確定刪除第 ${row.level} 級（投保金額 ${fmt(row.insuredAmount)}）？所有公司的薪資計算都會受影響。`)) return;
    try {
      await payrollApi.deleteBracket(row.id);
      reload();
    } catch (error) {
      toast({ title: "刪除失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="投保級距表" description="臺灣勞保、健保及勞退的投保（提繳）級距，薪資計算依此表決定投保金額" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.entries(rateInfo) as [BracketType, (typeof rateInfo)[BracketType]][]).map(([key, r]) => {
          const I = r.icon;
          return (
            <Card key={key} className={tab === key ? "ring-2 ring-blue-500" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <I className="h-5 w-5 text-blue-600" />
                  <span className="font-semibold">{r.title}</span>
                </div>
                <div className="text-sm space-y-1 text-gray-600">
                  <div>費率：{r.rate}</div>
                  <div>員工負擔：{r.employee}</div>
                  <div>雇主負擔：{r.employer}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!loading && brackets.length === 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="brackets-empty-warning">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">尚未建立{info.label}級距表</p>
            <p>在建立之前，薪資計算會直接用原薪資當作投保金額，保費會與實際應繳金額不同。{canManage ? "請按「整批貼上」從主管機關公告的分級表匯入。" : "請聯絡平台管理員匯入。"}</p>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as BracketType)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="labor">勞保</TabsTrigger>
            <TabsTrigger value="health">健保</TabsTrigger>
            <TabsTrigger value="pension">勞退</TabsTrigger>
          </TabsList>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={loadOfficial} disabled={saving} data-testid="button-brackets-load-official">
                <Download className="mr-1.5 h-4 w-4" />載入 {BRACKET_YEAR_LABEL} 官方級距
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)} data-testid="button-brackets-paste">
                <ClipboardPaste className="mr-1.5 h-4 w-4" />整批貼上
              </Button>
            </div>
          )}
        </div>

        <TabsContent value={tab}>
          {canManage && batch.count > 0 && (
            <BatchActionBar
              count={batch.count}
              entityName="級距"
              entityEndpoint="insurance-brackets"
              ids={batch.ids}
              batchFields={[]}
              onClear={batch.clearSelection}
              onComplete={reload}
            />
          )}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable
                isLoading={loading}
                data={brackets}
                emptyMessage="尚無級距資料"
                columns={[
                  ...(canManage ? [{
                    header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                    accessor: (r: InsuranceBracket) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />,
                    className: "w-10 px-2",
                  }] : []),
                  { header: "級數", accessor: "level" as const, className: "w-16 text-center" },
                  { header: "最低薪資", accessor: (r: InsuranceBracket) => fmt(r.minSalary), className: "text-right font-mono" },
                  { header: "最高薪資", accessor: (r: InsuranceBracket) => r.maxSalary ? fmt(r.maxSalary) : "—", className: "text-right font-mono" },
                  { header: "投保金額", accessor: (r: InsuranceBracket) => fmt(r.insuredAmount), className: "text-right font-mono font-semibold text-blue-600" },
                  ...(canManage ? [{
                    header: "",
                    accessor: (r: InsuranceBracket) => (
                      <Button variant="ghost" size="icon" title="刪除" onClick={() => removeBracket(r)}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    ),
                    className: "w-12",
                  }] : []),
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>整批貼上{info.label}級距</DialogTitle>
            <DialogDescription>
              從主管機關公告的分級表複製貼上，每行一級：最低薪資、最高薪資、投保金額（最高薪資可留空或寫 -，代表「以上」）。
              匯入會取代目前全部的{info.label}級距，並套用到所有公司。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"0\t29500\t29500\n29501\t30300\t30300\n30301\t-\t31800"}
            className="font-mono text-sm"
            data-testid="textarea-brackets-paste"
          />
          <div className="text-sm">
            {parsed.errors.length > 0
              ? <ul className="list-disc pl-5 text-destructive">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
              : <span className="text-muted-foreground">已辨識 {parsed.rows.length} 級</span>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>取消</Button>
            <Button onClick={submitPaste} disabled={saving || parsed.errors.length > 0 || parsed.rows.length === 0}>
              取代並匯入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
