import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PaymentTermField } from "@/components/shared/payment-term";
import { LookupSelect } from "@/components/shared/lookup-select";
import { MasterLookup } from "@/components/shared/master-lookup";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";

/**
 * 客戶的「同一個畫面」（老闆 2026-11-16：一種資料只有一個表單，全系統共用）。
 * 銷售的客戶管理、會計的會計客戶，新增和編輯開的都是這裡的視窗，欄位一樣。
 * 儲存由這個視窗自己做，存好後用 onSaved 通知頁面重新整理自己的清單。
 */
const api = (p: string) => `/erp-api/${p}`;
export const CUSTOMER_CATEGORIES = ["個人客戶", "企業客戶", "學校客戶", "補教機構", "合作人員"];

/** 讀回應的 JSON；不是 JSON 或伺服器回錯誤時，丟出看得懂的訊息 */
export async function readJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(fallbackMessage);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!res.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : undefined;
    throw new Error(typeof message === "string" && message ? message : fallbackMessage);
  }
  return payload as T;
}

type CustForm = {
  customerCode: string; name: string; shortName: string; email: string;
  phone: string; mobile: string; contactPerson: string; salesPerson: string;
  address: string; city: string; country: string; taxId: string; category: string; paymentTermId: string; creditLimit: string; remarks: string;
};
const emptyForm: CustForm = {
  customerCode: "", name: "", shortName: "", email: "", phone: "", mobile: "",
  contactPerson: "", salesPerson: "", address: "", city: "", country: "", paymentTermId: "", creditLimit: "", taxId: "", category: "一般客戶", remarks: "",
};

/** 要編輯的客戶；兩個頁面拿到的資料型別不同，這裡只列表單會用到的欄位 */
export type CustomerRecord = {
  id: number;
  name?: string | null;
  isActive?: boolean | null;
  paymentTermId?: number | string | null;
  creditLimit?: number | string | null;
  [key: string]: unknown;
};

const text = (v: unknown) => (v == null ? "" : String(v));

/** 新增／編輯客戶。customer 給 null 是新增，給客戶資料是編輯 */
export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerRecord | null;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<CustForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const editing = customer ?? null;

  // 每次打開：編輯就帶入這個客戶的資料，新增就給空白表單和一個新編號
  useEffect(() => {
    if (!open) return;
    if (!editing) {
      setForm({ ...emptyForm, customerCode: `C-${Date.now().toString().slice(-6)}` });
      return;
    }
    const c = editing;
    setForm({
      customerCode: text(c.customerCode), name: text(c.name), shortName: text(c.shortName),
      email: text(c.email), phone: text(c.phone), mobile: text(c.mobile),
      contactPerson: text(c.contactPerson), salesPerson: text(c.salesPerson),
      address: text(c.address), city: text(c.city), country: text(c.country),
      taxId: text(c.taxId), category: text(c.category) || "一般客戶",
      paymentTermId: c.paymentTermId ? String(c.paymentTermId) : "",
      creditLimit: c.creditLimit != null && Number(c.creditLimit) > 0 ? String(Number(c.creditLimit)) : "",
      remarks: text(c.remarks),
    });
    // 只在打開、或換了一個客戶時重設，避免清單重新整理把打到一半的內容蓋掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const F = (key: keyof CustForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  const done = () => {
    qc.invalidateQueries({ queryKey: ["/erp-api/customers"] });
    onOpenChange(false);
    onSaved?.();
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.name) { toast({ title: "請填寫客戶名稱", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(editing ? api(`customers/${editing.id}`) : api("customers"), {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await readJsonResponse(res, "無法儲存客戶資料，請稍後再試。");
      toast({ title: editing ? "客戶已更新" : "客戶已建立" });
      done();
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // 停用／恢復啟用：資料都留著，只是開單時選不到
  const toggleActive = async () => {
    if (!editing) return;
    const next = editing.isActive === false;
    if (!next && !confirm(`確定停用「${editing.name}」？\n資料和歷史單據都會保留，只是開單時不會再出現在選單裡，之後可以隨時恢復。`)) return;
    const res = await fetch(api(`customers/${editing.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: next }) });
    if (!res.ok) { toast({ title: "操作失敗", variant: "destructive" }); return; }
    toast({ title: next ? "已恢復啟用" : "已停用" });
    done();
  };

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name={editing ? "編輯客戶" : "新增客戶"}
      footer={<>
          {editing && (
            <Button type="button" variant="ghost" className="mr-auto" data-testid="button-toggle-active" onClick={toggleActive} disabled={saving}>
              {editing.isActive === false ? "恢復啟用" : "停用這個客戶"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="button-save-customer">
            {saving ? "處理中..." : editing ? "更新" : "建立"}
          </Button>
      </>}
    >
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label htmlFor="customer-code">客戶編號</Label><Input id="customer-code" value={form.customerCode} onChange={F("customerCode")} data-testid="input-customer-code" /></div>
            <div><Label htmlFor="customer-name">客戶名稱 *</Label><Input id="customer-name" required aria-required="true" value={form.name} onChange={F("name")} data-testid="input-customer-name" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label htmlFor="customer-short-name">簡稱</Label><Input id="customer-short-name" value={form.shortName} onChange={F("shortName")} /></div>
            {/* 這兩個下拉元件不收 id，改用群組標籤讓讀屏軟體念得出欄位名稱 */}
            <div role="group" aria-labelledby="customer-category-label">
              <Label id="customer-category-label">分類</Label>
              <LookupSelect className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.category} onChange={F("category")}>
                <option value="一般客戶">一般客戶</option>
                {CUSTOMER_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </LookupSelect>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label htmlFor="customer-contact">聯絡人</Label><Input id="customer-contact" value={form.contactPerson} onChange={F("contactPerson")} /></div>
            <div role="group" aria-labelledby="customer-sales-person-label">
              <Label id="customer-sales-person-label">業務負責人</Label>
              <MasterLookup source="employees" valueKey="name" value={form.salesPerson} onValueChange={v => setForm(p => ({ ...p, salesPerson: v }))} placeholder="選擇員工" />
            </div>
          </div>
          <div><Label htmlFor="customer-email">Email</Label><Input id="customer-email" type="email" value={form.email} onChange={F("email")} /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label htmlFor="customer-phone">電話</Label><Input id="customer-phone" value={form.phone} onChange={F("phone")} /></div>
            <div><Label htmlFor="customer-mobile">手機</Label><Input id="customer-mobile" value={form.mobile} onChange={F("mobile")} /></div>
          </div>
          <div><Label htmlFor="customer-address">地址</Label><Input id="customer-address" value={form.address} onChange={F("address")} /></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label htmlFor="customer-city">城市</Label><Input id="customer-city" value={form.city} onChange={F("city")} /></div>
            <div><Label htmlFor="customer-country">國家</Label><Input id="customer-country" value={form.country} onChange={F("country")} /></div>
            <div><Label htmlFor="customer-tax-id">統編</Label><Input id="customer-tax-id" value={form.taxId} onChange={F("taxId")} /></div>
          </div>
          <PaymentTermField id="customer-payment-term" value={form.paymentTermId} onChange={(value) => setForm(p => ({ ...p, paymentTermId: value }))} label="預設付款條件" />
          <div>
            <Label htmlFor="customer-credit-limit">信用額度</Label>
            <Input id="customer-credit-limit" type="number" inputMode="decimal" min="0" value={form.creditLimit} onChange={F("creditLimit")} placeholder="空白是不限" />
            <p className="mt-1 text-xs text-muted-foreground">這個客戶最多可以欠多少。欠款加上新訂單超過就不能成立訂單，老闆或財務可以個別放行。</p>
          </div>
          <div>
            <Label htmlFor="customer-remarks">備註</Label>
            <textarea
              id="customer-remarks" rows={3} maxLength={2000} value={form.remarks} onChange={F("remarks")}
              placeholder="例如：聯絡注意事項、開票習慣、特殊約定"
              className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
    </DocWindow>
  );
}
