import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Loader2 } from "lucide-react";

interface ProviderState {
  configured: boolean;
  settings?: Record<string, any>;
  secretHint?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  platformFallback: boolean;
  platformFromEmail?: string;
}
interface Status { canSave: boolean; ecpay_invoice: ProviderState; resend: ProviderState; icta_pro?: ProviderState }

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `失敗（HTTP ${r.status}）`);
  return data;
}

function StatusBadge({ state, fallbackText }: { state: ProviderState; fallbackText: string }) {
  if (state.configured) return <Badge className="bg-green-100 text-green-800">使用自己的設定</Badge>;
  if (state.platformFallback) return <Badge variant="secondary">{fallbackText}</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">尚未設定</Badge>;
}

function Updated({ state }: { state: ProviderState }) {
  if (!state.configured || !state.updatedAt) return null;
  return <p className="text-xs text-muted-foreground">金鑰 {state.secretHint} · {state.updatedBy} 於 {new Date(state.updatedAt).toLocaleString("zh-TW")} 更新</p>;
}

export default function IntegrationKeysPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = () => call("GET", "/erp-api/settings/integrations").then(setStatus).catch((e) => setLoadError(e.message));
  useEffect(() => { reload(); }, []);

  if (loadError) return <div className="p-6 text-red-700">{loadError}</div>;
  if (!status) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={16} />載入中…</div>;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound size={22} />串接金鑰</h1>
      <p className="text-sm text-muted-foreground">
        每家公司填自己的綠界電子發票與寄信帳號。金鑰存進去後會加密，畫面上只顯示最後四碼；要換就重新填，留空代表沿用原本的。
      </p>
      {!status.canSave && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          平台還沒設定加密主金鑰，暫時不能儲存。請通知系統管理員在主機設定 ERP_SECRETS_KEY。
        </div>
      )}
      <EcpayCard state={status.ecpay_invoice} disabled={!status.canSave} onSaved={reload} />
      <ResendCard state={status.resend} disabled={!status.canSave} onSaved={reload} />
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  return { busy, msg, run };
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`} role="status">{msg.text}</span>;
}

function EcpayCard({ state, disabled, onSaved }: { state: ProviderState; disabled: boolean; onSaved: () => void }) {
  const [merchantId, setMerchantId] = useState(String(state.settings?.merchantId || ""));
  const [environment, setEnvironment] = useState<string>(String(state.settings?.environment || "production"));
  const [hashKey, setHashKey] = useState("");
  const [hashIV, setHashIV] = useState("");
  const { busy, msg, run } = useAction();

  const save = () => run(async () => {
    await call("PUT", "/erp-api/settings/integrations/ecpay_invoice", { merchantId, environment, hashKey, hashIV });
    setHashKey(""); setHashIV(""); onSaved();
    return "已儲存，之後開發票會用這組綠界帳號";
  });
  const remove = () => {
    if (!confirm("確定要刪除這家公司的綠界設定？刪除後就不能開電子發票。")) return;
    run(async () => { await call("DELETE", "/erp-api/settings/integrations/ecpay_invoice"); onSaved(); return "已刪除"; });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">綠界電子發票</CardTitle>
        <StatusBadge state={state} fallbackText="使用平台預設帳號" />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">在綠界廠商後台 › 系統開發管理 › 系統介接設定，可以找到商店代號、HashKey、HashIV。</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ecpay-merchant">商店代號（MerchantID）</Label>
            <Input id="ecpay-merchant" inputMode="numeric" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="例如 2000132" />
          </div>
          <div>
            <Label htmlFor="ecpay-env">環境</Label>
            <select id="ecpay-env" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              <option value="production">正式（真的開出發票）</option>
              <option value="stage">測試（綠界測試環境）</option>
            </select>
          </div>
          <div>
            <Label htmlFor="ecpay-key">HashKey</Label>
            <Input id="ecpay-key" type="password" autoComplete="off" value={hashKey} onChange={(e) => setHashKey(e.target.value)}
              placeholder={state.configured ? `已設定 ${state.secretHint}（留空沿用）` : "16 個字元"} />
          </div>
          <div>
            <Label htmlFor="ecpay-iv">HashIV</Label>
            <Input id="ecpay-iv" type="password" autoComplete="off" value={hashIV} onChange={(e) => setHashIV(e.target.value)}
              placeholder={state.configured ? "已設定（留空沿用）" : "16 個字元"} />
          </div>
        </div>
        <Updated state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || disabled}>{busy && <Loader2 className="animate-spin mr-1" size={14} />}儲存</Button>
          {state.configured && <Button variant="outline" onClick={remove} disabled={busy}>刪除設定</Button>}
          <Message msg={msg} />
        </div>
      </CardContent>
    </Card>
  );
}

// 七期網站不連講師平台，這張卡片不顯示
void IctaCard;
function IctaCard({ state, disabled, onSaved }: { state: ProviderState; disabled: boolean; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(String(state.settings?.baseUrl || "https://icta-pro.com"));
  const [apiKey, setApiKey] = useState("");
  const { busy, msg, run } = useAction();

  const save = () => run(async () => {
    await call("PUT", "/erp-api/settings/integrations/icta_pro", { baseUrl, apiKey });
    setApiKey(""); onSaved();
    return "已儲存，銷貨單可以送件到講師平台了";
  });
  const remove = () => {
    if (!confirm("確定要刪除講師平台的連線設定？刪除後銷貨單就不能送件。")) return;
    run(async () => { await call("DELETE", "/erp-api/settings/integrations/icta_pro"); onSaved(); return "已刪除"; });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">講師平台（ICTA PRO）</CardTitle>
        <StatusBadge state={state} fallbackText="" />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          設定好之後，已成立的銷貨單會多一個「送件到講師平台」的按鈕，把案件送到 ICTA PRO 找講師。金鑰請在 ICTA PRO 後台的「合作夥伴金鑰」建立，名稱要以 ERP 開頭。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="icta-url">講師平台網址</Label>
            <Input id="icta-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://icta-pro.com" />
          </div>
          <div>
            <Label htmlFor="icta-key">金鑰</Label>
            <Input id="icta-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={state.configured ? `已設定 ${state.secretHint}（留空沿用）` : "icta_pk_ 開頭"} />
          </div>
        </div>
        <Updated state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || disabled}>{busy && <Loader2 className="animate-spin mr-1" size={14} />}儲存</Button>
          {state.configured && <Button variant="outline" onClick={remove} disabled={busy}>刪除設定</Button>}
        </div>
        <Message msg={msg} />
      </CardContent>
    </Card>
  );
}

function ResendCard({ state, disabled, onSaved }: { state: ProviderState; disabled: boolean; onSaved: () => void }) {
  const [fromEmail, setFromEmail] = useState(String(state.settings?.fromEmail || ""));
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");
  const { busy, msg, run } = useAction();

  const save = () => run(async () => {
    await call("PUT", "/erp-api/settings/integrations/resend", { fromEmail, apiKey });
    setApiKey(""); onSaved();
    return "已儲存，之後寄信會用這個帳號";
  });
  const remove = () => {
    if (!confirm("確定要刪除這家公司的寄信設定？刪除後改用平台預設信箱寄出。")) return;
    run(async () => { await call("DELETE", "/erp-api/settings/integrations/resend"); onSaved(); return "已刪除"; });
  };
  const test = () => run(async () => {
    await call("POST", "/erp-api/settings/integrations/resend/test", { to: testTo });
    return `測試信已寄到 ${testTo}，請去收信確認`;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">寄信帳號（Resend）</CardTitle>
        <StatusBadge state={state} fallbackText={`使用平台信箱 ${state.platformFromEmail || ""}`} />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          沒填的話，信會從平台的 {state.platformFromEmail} 寄出。想用自己公司的網域寄，請先在 Resend 驗證網域，再建立 API Key 填在這裡。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="resend-from">寄件信箱</Label>
            <Input id="resend-from" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="service@你的網域.com" />
          </div>
          <div>
            <Label htmlFor="resend-key">API Key</Label>
            <Input id="resend-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={state.configured ? `已設定 ${state.secretHint}（留空沿用）` : "re_ 開頭"} />
          </div>
        </div>
        <Updated state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy || disabled}>{busy && <Loader2 className="animate-spin mr-1" size={14} />}儲存</Button>
          {state.configured && <Button variant="outline" onClick={remove} disabled={busy}>刪除設定</Button>}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="resend-test">寄測試信到</Label>
            <Input id="resend-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="你的信箱" />
          </div>
          <Button variant="outline" onClick={test} disabled={busy || !testTo}>寄測試信</Button>
        </div>
        <Message msg={msg} />
      </CardContent>
    </Card>
  );
}
