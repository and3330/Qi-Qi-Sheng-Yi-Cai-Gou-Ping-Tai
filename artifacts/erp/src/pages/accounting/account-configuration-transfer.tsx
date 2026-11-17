import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountConfiguration, AccountConfigurationPreview } from "@workspace/erp-api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Upload, Loader2 } from "lucide-react";

async function request(path: string, body?: unknown) {
  const response = await fetch(`/erp-api/accounts/configuration/${path}`, {
    credentials: "include", ...(body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `操作失敗（${response.status}），請確認新版功能已發布`);
  return result;
}

export function AccountConfigurationTransfer() {
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configuration, setConfiguration] = useState<AccountConfiguration | null>(null);
  const [preview, setPreview] = useState<AccountConfigurationPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  if (!hasRole("owner", "admin", "finance_admin", "accountant")) return null;

  async function download() {
    setBusy(true); setError(""); setSuccess("");
    try {
      const data = await request("export") as AccountConfiguration;
      const [files, XLSX] = await Promise.all([import("@/lib/account-configuration-file"), import("xlsx")]);
      XLSX.writeFile(files.createAccountConfigurationWorkbook(data), `會計科目設定_${data.companyCode}.xlsx`);
      setSuccess(`已下載全部 ${data.accounts.length} 筆科目設定（不受目前搜尋或分類篩選影響）`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "下載失敗"); }
    finally { setBusy(false); }
  }
  async function loadPreview(data: AccountConfiguration) {
    setBusy(true); setError(""); setPreview(null); setConfirmation("");
    try { setPreview(await request("preview", data)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "預覽失敗"); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setOpen(true); setBusy(true); setError(""); setSuccess("");
    setConfiguration(null); setPreview(null); setConfirmation("");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("請選擇 .xlsx 格式的科目設定檔");
      if (file.size > 10 * 1024 * 1024) throw new Error("檔案不得超過 10 MB");
      const { readAccountConfigurationWorkbook } = await import("@/lib/account-configuration-file");
      const data = readAccountConfigurationWorkbook(await file.arrayBuffer());
      if (data.companyCode !== user?.companyCode) throw new Error("檔案公司統編與目前登入公司不符，已停止匯入");
      setConfiguration(data);
      await loadPreview(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "讀取檔案失敗"); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!configuration || !preview || confirmation !== "新增缺少科目") return;
    setBusy(true); setError("");
    try {
      const result = await request("import", { configuration, fingerprint: preview.fingerprint, confirmation });
      setSuccess(`匯入完成：新增 ${result.inserted} 筆，保留既有 ${result.existing} 筆。既有餘額與分錄未更動。`);
      setOpen(false); setPreview(null); setConfiguration(null); setConfirmation("");
      await queryClient.invalidateQueries();
    } catch (cause) {
      // Do not automatically retry writes. A fresh explicit preview is always required.
      setPreview(null); setConfirmation("");
      setError(cause instanceof Error ? cause.message : "匯入失敗");
    } finally { setBusy(false); }
  }
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={download} disabled={busy}><Download className="h-4 w-4 mr-1" />下載科目設定</Button>
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}><Upload className="h-4 w-4 mr-1" />批量上傳科目</Button>
          <input ref={input} type="file" className="hidden" accept=".xlsx" aria-label="上傳會計科目設定 Excel" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }} />
        </div>
        {success && <p role="status" className="text-sm text-green-700">{success}</p>}
        {!open && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量上傳會計科目設定</DialogTitle>
            <DialogDescription>目前公司統編：{user?.companyCode}。只新增缺少科目，不覆寫既有名稱、餘額、現金流量分類或分錄。檔案需由同公司的「下載科目設定」取得。</DialogDescription>
          </DialogHeader>
          {busy && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />處理中，請勿重複操作</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {preview && <div className="space-y-3">
            <p className="text-sm font-medium">檔案 {preview.total} 筆／新增 {preview.missing.length} 筆／保留既有 {preview.existing} 筆</p>
            {preview.conflicts.length > 0 && <div className="max-h-32 overflow-y-auto text-sm text-red-600">
              <p className="font-medium">發現結構衝突，不能匯入：</p>{preview.conflicts.map((item, index) => <p key={index}>{item}</p>)}
            </div>}
            {preview.warnings.length > 0 && <div className="max-h-24 overflow-y-auto text-sm text-amber-700">{preview.warnings.map((item, index) => <p key={index}>{item}</p>)}</div>}
            {preview.missing.length > 0 && <div className="max-h-60 overflow-auto border rounded">
              <table className="w-full text-sm"><thead><tr className="text-left bg-gray-50"><th className="p-2">編碼</th><th className="p-2">科目名稱</th><th className="p-2">上層編碼</th><th className="p-2">群組</th></tr></thead>
                <tbody>{preview.missing.map(row => <tr key={row.accountNumber} className="border-t"><td className="p-2 font-mono">{row.accountNumber}</td><td className="p-2">{row.accountName}</td><td className="p-2">{row.parentCode ?? "頂層"}</td><td className="p-2">{row.isGroup ? "是" : "否"}</td></tr>)}</tbody>
              </table>
            </div>}
            {!preview.missing.length && !preview.conflicts.length && <p className="text-sm">所有科目均已存在，不需要匯入。</p>}
            <label className="block text-sm">確認後請輸入「新增缺少科目」<Input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
          </div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>關閉</Button>
            {configuration && !preview && <Button variant="outline" onClick={() => loadPreview(configuration)} disabled={busy}>重新預覽</Button>}
            <Button onClick={apply} disabled={busy || !preview || preview.conflicts.length > 0 || preview.missing.length === 0 || confirmation !== "新增缺少科目"}>確認新增科目</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
