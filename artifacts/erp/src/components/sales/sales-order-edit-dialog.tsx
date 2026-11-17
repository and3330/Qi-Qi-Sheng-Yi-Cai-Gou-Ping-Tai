import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { LookupSelect } from "@/components/shared/lookup-select";
import { templateDefaults, templateAppliesTo, suggestTemplateForGroups, withoutLegacyFields } from "@/lib/template-fields";
import { selectClass, todayText } from "@/lib/call";

/**
 * 銷貨單的「同一個畫面」（老闆 2026-11-16：一種單據只有一個表單，全系統共用）。
 * 銷貨單清單的新增、複製、編輯，和銷貨單明細頁的編輯，開的都是這裡的視窗，欄位位置一樣。
 *
 * 哪些欄位能改，跟著伺服器的規則走（artifacts/api-server/src/lib/legacy.ts）：
 *   - 新增、草稿：全部都能改
 *   - 已成立（不是草稿）：只能改說明性的欄位；品項、金額、客戶、日期、專案、部門鎖住
 *   - Ecount 歷史單：同上，但專案與部門可以補；狀態不能改
 * 不能改的欄位照樣顯示（鎖住），所以不管從哪裡打開、哪種狀態，看到的都是同一張表單。
 * 狀態不在這裡改：伺服器規定內容與狀態要分開送。
 */

const STATUS_LABEL: Record<string, string> = { Draft: "草稿", Confirmed: "已確認", "To Deliver": "待出貨", Completed: "已完成", Cancelled: "已取消" };
const SOURCE_LABELS: Record<string, string> = {
  ecount: "Ecount 歷史單",
  manual: "手動建立", quick_entry: "快速錄單",
  api_ecommerce: "API匯入-商城", api_event: "API匯入-活動平台",
};
const MATERIAL_FEE_OPTIONS = ["不需要", "老師代收", "公司收取", "其他"];
const TRANSACTION_TYPES = ["營業稅", "免稅", "零稅率"];
/** 類別頁籤：只決定要不要顯示課程（服務）那一區，不會存進單據 */
const TABS = ["校園", "活動", "課程", "居家服務", "商城", "其他"] as const;
const BUSINESS_TAB: Record<string, string> = { campus: "校園", event: "活動", home_service: "居家服務", ecommerce: "商城", other: "其他" };

/** Ecount 歷史單可以改的欄位（跟伺服器的 LEGACY_SALES_EDITABLE 一致） */
const LEGACY_EDITABLE = new Set([
  "label", "remarks", "projectId", "departmentId", "handlerId", "deliveryDate", "dateDetails",
  "classWeeks", "courseStartDate", "courseEndDate", "caseTime", "coursePeriod",
  "teacherCode", "teacherFeePerSession", "teacherMaterialFeeMethod", "warehouseCode", "invoiceTaxId", "invoiceTitle",
  "templateId", "extraFields",
]);
/** 已成立的一般銷貨單可以改的欄位：比歷史單少了專案與部門（跟伺服器的 CONFIRMED_SALES_EDITABLE 一致） */
const POSTED_EDITABLE = new Set([...LEGACY_EDITABLE].filter(key => key !== "projectId" && key !== "departmentId"));

/** 這些模板欄位存在銷貨單本身的欄位（課程資訊等），不放在 extraFields */
const COLUMN_FIELDS = new Set(["classWeeks", "courseStartDate", "courseEndDate", "caseTime", "coursePeriod", "teacherCode", "teacherFeePerSession", "teacherMaterialFeeMethod", "dateDetails", "deliveryDate", "label", "remarks"]);
const COURSE_FIELDS = ["classWeeks", "courseStartDate", "courseEndDate", "caseTime", "coursePeriod", "teacherCode", "teacherFeePerSession"] as const;

interface FieldDef { name: string; label: string; type: string; required?: boolean; options?: string[] }
interface TemplateInfo { id: number; name: string; businessType: string; fieldSchema: FieldDef[]; isActive: boolean; projectId: number | null; defaultValues?: unknown }
interface Line { itemId?: number | null; code?: string; itemName: string; quantity: number; unit?: string; rate: number; amount: number; summary?: string }
interface RegistrantForm { id?: number; name: string; contactInfo: string; age: string; grade: string; notes: string }

export type SalesOrderForm = {
  orderNumber: string; customerId: string; orderDate: string; deliveryDate: string;
  totalAmount: string; status: string; departmentId: string; projectId: string;
  items: Line[];
  /** 類別頁籤；空白＝照模板的業務類型自動決定 */
  template: string;
  label: string; handlerId: string; classWeeks: string;
  courseStartDate: string; courseEndDate: string; caseTime: string;
  teacherCode: string; teacherFeePerSession: string; teacherMaterialFeeMethod: string;
  coursePeriod: string; warehouseCode: string; transactionType: string;
  dateDetails: string; remarks: string;
  templateId: string; orderSource: string;
  /** 模板自訂欄位目前填的值（一律用文字，存檔時再照欄位型別轉） */
  extraFields: Record<string, string>;
  registrants: RegistrantForm[];
  invoiceTaxId: string; invoiceTitle: string;
};

const emptyLine = (): Line => ({ itemId: null, code: "", itemName: "", quantity: 1, unit: "個", rate: 0, amount: 0, summary: "" });
const emptyForm = (): SalesOrderForm => ({
  orderNumber: "", customerId: "", orderDate: todayText(),
  deliveryDate: "", totalAmount: "0", status: "Draft", departmentId: "", projectId: "",
  items: [emptyLine()],
  template: "", label: "", handlerId: "", classWeeks: "",
  courseStartDate: "", courseEndDate: "", caseTime: "",
  teacherCode: "", teacherFeePerSession: "", teacherMaterialFeeMethod: "不需要",
  coursePeriod: "", warehouseCode: "", transactionType: "營業稅",
  dateDetails: "", remarks: "",
  templateId: "", orderSource: "manual", extraFields: {},
  registrants: [],
  invoiceTaxId: "", invoiceTitle: "",
});

const linesOf = (items: unknown): Line[] => Array.isArray(items) && items.length > 0
  ? items.map((it: any) => ({ itemId: it.itemId ?? null, code: it.code || "", itemName: it.itemName || it.name || "", quantity: Number(it.quantity) || 1, unit: it.unit || "個", rate: Number(it.rate) || 0, amount: Number(it.amount) || 0, summary: it.summary || "" }))
  : [emptyLine()];
/** 模板欄位裡看得懂的值（文字、數字）；歷史標記（legacy…）和系統自己放的資料不給改 */
const scalarExtras = (extra: unknown): Record<string, string> => Object.fromEntries(
  Object.entries((extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>)
    .filter(([key, value]) => !key.startsWith("legacy") && (typeof value === "string" || typeof value === "number"))
    .map(([key, value]) => [key, String(value)]),
);

/** 把一張銷貨單轉成表單內容 */
function formFromOrder(o: any): SalesOrderForm {
  // 草稿才幫忙補預設值；已成立的單和歷史單照原樣顯示，才不會沒改也被當成有改
  const full = o.status === "Draft" && o.orderSource !== "ecount";
  return {
    orderNumber: o.orderNumber || "", customerId: String(o.customerId || ""),
    orderDate: o.orderDate || "", deliveryDate: o.deliveryDate || "",
    totalAmount: String(o.totalAmount || 0), status: o.status || "Draft",
    departmentId: o.departmentId ? String(o.departmentId) : "", projectId: o.projectId ? String(o.projectId) : "",
    items: linesOf(o.items),
    template: "", label: o.label || "", handlerId: o.handlerId ? String(o.handlerId) : "",
    classWeeks: o.classWeeks ? String(o.classWeeks) : "",
    courseStartDate: o.courseStartDate || "", courseEndDate: o.courseEndDate || "",
    caseTime: o.caseTime || "", teacherCode: o.teacherCode || "",
    teacherFeePerSession: o.teacherFeePerSession ? String(Number(o.teacherFeePerSession)) : "",
    teacherMaterialFeeMethod: o.teacherMaterialFeeMethod || (full ? "不需要" : ""),
    coursePeriod: o.coursePeriod || "", warehouseCode: o.warehouseCode || "",
    transactionType: o.transactionType || (full ? "營業稅" : ""),
    dateDetails: o.dateDetails || "", remarks: o.remarks || "",
    templateId: o.templateId ? String(o.templateId) : "",
    orderSource: o.orderSource || "manual",
    extraFields: scalarExtras(o.extraFields),
    registrants: [],
    invoiceTaxId: o.invoiceTaxId || "", invoiceTitle: o.invoiceTitle || "",
  };
}

/** 複製一張銷貨單時帶到新單的內容：品項、客戶、課程資訊照抄；單號、日期、狀態、報名人員重新來 */
export function salesOrderCopyValues(o: any): Partial<SalesOrderForm> {
  const base = formFromOrder({ ...o, status: "Draft", orderSource: "manual" });
  const items = base.items.map(line => ({ ...line, amount: line.amount || line.quantity * line.rate }));
  return {
    ...base, items,
    orderNumber: "", orderDate: todayText(), deliveryDate: "", status: "Draft", orderSource: "manual",
    totalAmount: String(items.reduce((sum, line) => sum + line.amount, 0)),
    // 歷史單的標記不帶到新單，複製出來的是一張正常的新單
    extraFields: scalarExtras(withoutLegacyFields(o.extraFields)),
    registrants: [],
  };
}

export interface SalesOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 要編輯的銷貨單（清單的一列或明細頁讀到的那張都可以）；不給就是新增 */
  order?: any | null;
  /** 新增時預先帶入的內容（複製、從客戶頁按「開訂單」過來）；priceSource 是單價旁邊顯示的來源說明 */
  initial?: { values?: Partial<SalesOrderForm>; priceSource?: string } | null;
  /** 打開後直接捲到品項明細 */
  focus?: "items" | null;
  /** 存好之後通知頁面重新讀資料。pending＝已入帳的單，這次修改已送審、還沒生效 */
  onSaved?: (result: { id?: number; pending: boolean }) => void;
}

interface Lookups { customers: any[]; departments: any[]; projects: any[]; employees: any[]; teachers: any[]; warehouses: any[]; templates: TemplateInfo[]; items: any[] }
const NO_LOOKUPS: Lookups = { customers: [], departments: [], projects: [], employees: [], teachers: [], warehouses: [], templates: [], items: [] };

/** 員工顯示名稱：姓＋名（中文名字中間不加空白） */
const empName = (e: any) => e ? (e.fullName || e.name || `${e.firstName || ""}${/^[A-Za-z]/.test(e.lastName || "") ? " " : ""}${e.lastName || ""}`.trim()) : "";
const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const numberInputClass = "h-10 px-2 text-right text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function SalesOrderFormDialog({ open, onOpenChange, order, initial, focus, onSaved }: SalesOrderFormDialogProps) {
  const { toast } = useToast();
  const [lookups, setLookups] = useState<Lookups>(NO_LOOKUPS);
  const lookupsLoaded = useRef(false);
  const [form, setForm] = useState<SalesOrderForm>(emptyForm);
  const [priceMeta, setPriceMeta] = useState<{ touched: boolean; source: string }[]>([{ touched: false, source: "" }]);
  const [lineWarnings, setLineWarnings] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  /** 打開當下的內容：已成立的單和歷史單只送有改的欄位，要拿它來比 */
  const initialForm = useRef<SalesOrderForm>(emptyForm());
  /** 單據原本的 extraFields（歷史標記除外）：模板換了、或裡面有系統放的資料，都不會被這裡蓋掉 */
  const extraBase = useRef<Record<string, unknown>>({});
  const originalRegistrants = useRef<RegistrantForm[]>([]);
  const invoicePrefilled = useRef(false);
  const openSeq = useRef(0);
  const wasOpen = useRef(false);
  const itemsRef = useRef<HTMLDivElement | null>(null);

  const { customers, departments, projects, employees, teachers, warehouses, templates, items: catalogItems } = lookups;
  const isLegacy = order?.orderSource === "ecount";
  const mode: "create" | "draft" | "posted" | "legacy" = !order ? "create" : isLegacy ? "legacy" : order.status === "Draft" ? "draft" : "posted";
  /** 新增與草稿：整張單都能改 */
  const full = mode === "create" || mode === "draft";
  const can = (field: string) => full || (mode === "legacy" ? LEGACY_EDITABLE : POSTED_EDITABLE).has(field);
  const lockedTitle = mode === "legacy" ? "歷史單的這個欄位不能改（帳已經入過了）" : "這張單已經成立，這個欄位要退回草稿才能改";
  const lock = (field: string) => (can(field) ? {} : { disabled: true, title: lockedTitle });
  const set = <K extends keyof SalesOrderForm>(key: K, value: SalesOrderForm[K]) => setForm(p => ({ ...p, [key]: value }));

  // 下拉選單要用的主檔：第一次打開時讀一次
  useEffect(() => {
    if (!open || lookupsLoaded.current) return;
    lookupsLoaded.current = true;
    const get = (path: string) => fetch(`/erp-api/${path}`).then(r => (r.ok ? r.json() : [])).then(d => (Array.isArray(d) ? d : [])).catch(() => []);
    Promise.all(["customers", "departments", "projects", "employees", "teachers", "warehouses", "order-templates", "items"].map(get))
      .then(([c, d, p, e, t, w, tpl, it]) => setLookups({ customers: c, departments: d, projects: p, employees: e, teachers: t, warehouses: w, templates: tpl, items: it }));
  }, [open]);

  // 每次打開：照「編輯哪一張」或「新增要帶什麼」把表單準備好
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const seq = ++openSeq.current;
    const next: SalesOrderForm = order
      ? formFromOrder(order)
      : { ...emptyForm(), orderNumber: `SO-${Date.now().toString().slice(-8)}`, ...(initial?.values || {}) };
    initialForm.current = next;
    extraBase.current = order ? withoutLegacyFields(order.extraFields) : {};
    originalRegistrants.current = [];
    invoicePrefilled.current = false;
    setForm(next);
    setPriceMeta(next.items.map(() => (order ? { touched: true, source: "手動" } : initial?.priceSource ? { touched: true, source: initial.priceSource } : { touched: false, source: "" })));
    setLineWarnings({});
    setSaving(false);
    if (order?.id) {
      fetch(`/erp-api/sales-orders/${order.id}/registrants`).then(r => (r.ok ? r.json() : [])).then((list: any[]) => {
        if (seq !== openSeq.current || !Array.isArray(list)) return;
        const rows: RegistrantForm[] = list.map(r => ({ id: r.id, name: r.name || "", contactInfo: r.contactInfo || "", age: r.age || "", grade: r.grade || "", notes: r.notes || "" }));
        originalRegistrants.current = rows;
        setForm(p => ({ ...p, registrants: rows.map(r => ({ ...r })) }));
      }).catch(() => {});
    }
    if (focus === "items") window.setTimeout(() => { if (seq === openSeq.current) itemsRef.current?.scrollIntoView({ block: "start" }); }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 新增與草稿：開票的統編、抬頭還空著，就先帶客戶的（可以再改）
  useEffect(() => {
    if (!open || !full || invoicePrefilled.current || !form.customerId || customers.length === 0) return;
    invoicePrefilled.current = true;
    const cust = customers.find((c: any) => String(c.id) === String(form.customerId));
    if (!cust) return;
    setForm(p => ({
      ...p,
      invoiceTaxId: p.invoiceTaxId?.trim() ? p.invoiceTaxId : (cust.customerCode || cust.taxId || ""),
      invoiceTitle: p.invoiceTitle?.trim() ? p.invoiceTitle : (cust.name || ""),
    }));
  }, [open, full, form.customerId, customers]);

  // 品項單價、數量跟平常差很多時提醒（只有品項能改的時候才檢查）
  useEffect(() => {
    if (!open || !full) { setLineWarnings({}); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/erp-api/anomaly-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: "sales_order",
            customerId: form.customerId ? Number(form.customerId) : undefined,
            items: form.items.map(item => ({ itemId: item.itemId, rate: Number(item.rate), quantity: Number(item.quantity) })),
          }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as { warnings?: { index: number; message: string }[] };
        setLineWarnings(Object.fromEntries((data.warnings || []).map(warning => [warning.index, warning.message])));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLineWarnings({});
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, full, form.customerId, form.items]);

  const templateOf = (id: string) => (id ? templates.find(t => t.id === Number(id)) || null : null);
  const selectedTemplate = useMemo(() => templateOf(form.templateId), [form.templateId, templates]); // eslint-disable-line react-hooks/exhaustive-deps
  const schema = ((selectedTemplate?.fieldSchema || []) as FieldDef[]);
  /** 模板自訂欄位（存在 extraFields 的那些） */
  const extraSchema = schema.filter(fd => !COLUMN_FIELDS.has(fd.name));
  const columnSchema = schema.filter(fd => COLUMN_FIELDS.has(fd.name));
  /** 模板把單據本身的欄位設成必填時，那一格也要標星號（已成立的單與歷史單不強制） */
  const required = (name: string) => full && columnSchema.some(fd => fd.name === name && fd.required);
  const star = (name: string) => (required(name) ? <span className="ml-0.5 text-red-500">*</span> : null);
  // 可以選的模板：啟用中、銷售用、不綁專案或綁的就是這張單的專案；目前選的那個（就算停用了）也要列出來
  const availableTemplates = useMemo(() => templates.filter(t =>
    (t.isActive && templateAppliesTo(t as any, "sales") && (t.projectId == null || (form.projectId && String(t.projectId) === form.projectId)))
    || String(t.id) === form.templateId
  ), [templates, form.projectId, form.templateId]);

  const tab = form.template || (selectedTemplate ? ((TABS as readonly string[]).includes(selectedTemplate.businessType) ? selectedTemplate.businessType : BUSINESS_TAB[selectedTemplate.businessType]) : "") || "校園";
  const homeService = tab === "居家服務";
  // 課程（服務）資訊：校園、居家服務類，或這張單本來就有課程資料，或模板用到這些欄位，才顯示
  const hadCourseData = COURSE_FIELDS.some(name => !isBlank(initialForm.current[name]));
  const showCourse = tab === "校園" || homeService || hadCourseData || columnSchema.some(fd => (COURSE_FIELDS as readonly string[]).includes(fd.name) || fd.name === "teacherMaterialFeeMethod");

  // 新增訂單時，品項的分類對得上某個模板就自動帶出（編輯舊單不動）
  const lineGroupKey = useMemo(() => [...new Set(form.items.map(i => catalogItems.find((c: any) => c.itemCode === i.code)?.itemGroup).filter(Boolean))].sort().join("|"), [form.items, catalogItems]);
  useEffect(() => {
    if (!open || mode !== "create" || form.templateId || !lineGroupKey) return;
    const tpl = suggestTemplateForGroups(availableTemplates as any[], lineGroupKey.split("|")) as TemplateInfo | null;
    if (!tpl) return;
    applyTemplate(String(tpl.id));
    toast({ title: `已依品項帶入模板「${tpl.name}」` });
  }, [lineGroupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 換模板：已經填的內容留著，還空著的欄位帶入模板的預設值 */
  const applyTemplate = (id: string) => {
    const tpl = templateOf(id);
    const defaults = templateDefaults(tpl?.fieldSchema as any);
    setForm(p => {
      const next: SalesOrderForm = { ...p, templateId: id, extraFields: { ...p.extraFields } };
      if (tpl) next.template = (TABS as readonly string[]).includes(tpl.businessType) ? tpl.businessType : BUSINESS_TAB[tpl.businessType] || p.template;
      for (const [name, value] of Object.entries(defaults)) {
        if (COLUMN_FIELDS.has(name)) { if (can(name) && isBlank((next as any)[name])) (next as any)[name] = value; }
        else if (isBlank(next.extraFields[name])) next.extraFields[name] = value;
      }
      return next;
    });
  };

  const resolveItemPrice = async (idx: number, itemId: number, customerId: string, quantity: number) => {
    if (!customerId || !itemId || !Number.isFinite(quantity) || quantity <= 0) return;
    try {
      const response = await fetch(`/erp-api/price-lists/resolve?itemId=${itemId}&customerId=${customerId}&qty=${quantity}`);
      if (!response.ok) return;
      const resolved = await response.json();
      setPriceMeta(previous => {
        if (previous[idx]?.touched) return previous;
        setForm(current => {
          if (current.items[idx]?.itemId !== itemId || current.customerId !== customerId) return current;
          const newItems = [...current.items];
          newItems[idx] = { ...newItems[idx], rate: Number(resolved.price) || 0 };
          newItems[idx].amount = newItems[idx].quantity * newItems[idx].rate;
          return { ...current, items: newItems, totalAmount: String(newItems.reduce((sum, line) => sum + line.amount, 0)) };
        });
        const next = [...previous];
        next[idx] = { touched: false, source: resolved.source || "預設" };
        return next;
      });
    } catch {
      // 保留目前價格，避免解析服務暫時失敗時清空使用者輸入。
    }
  };
  const updateItem = (idx: number, field: keyof Line, value: any) => {
    const newItems = form.items.map((line, i) => (i === idx ? { ...line, [field]: value } : line));
    if (field === "quantity" || field === "rate") newItems[idx].amount = newItems[idx].quantity * newItems[idx].rate;
    const total = newItems.reduce((s, i) => s + i.amount, 0);
    setForm(p => ({ ...p, items: newItems, totalAmount: String(total) }));
    if (field === "rate") {
      setPriceMeta(previous => { const next = [...previous]; next[idx] = { touched: true, source: "手動" }; return next; });
    } else if (field === "quantity" && newItems[idx].itemId && !priceMeta[idx]?.touched) {
      void resolveItemPrice(idx, newItems[idx].itemId!, form.customerId, Number(value));
    }
  };
  const handleItemCodeChange = (idx: number, code: string) => {
    const ci = catalogItems.find((c: any) => c.itemCode === code);
    const newItems = [...form.items];
    newItems[idx] = {
      ...newItems[idx],
      code,
      ...(ci ? {
        itemId: ci.id ?? null,
        itemName: ci.itemName || newItems[idx].itemName,
        unit: ci.unit || newItems[idx].unit,
        rate: ci.sellingPrice != null && !isNaN(Number(ci.sellingPrice)) ? Number(ci.sellingPrice) : 0,
      } : {}),
    };
    newItems[idx].amount = newItems[idx].quantity * newItems[idx].rate;
    const total = newItems.reduce((s, i) => s + i.amount, 0);
    setForm(p => ({ ...p, items: newItems, totalAmount: String(total) }));
    setPriceMeta(previous => { const next = [...previous]; next[idx] = { touched: false, source: ci ? "預設" : "" }; return next; });
    if (ci?.id) void resolveItemPrice(idx, ci.id, form.customerId, newItems[idx].quantity);
  };
  const addItem = () => {
    setForm(p => ({ ...p, items: [...p.items, emptyLine()] }));
    setPriceMeta(previous => [...previous, { touched: false, source: "" }]);
  };
  const removeItem = (idx: number) => {
    if (form.items.length <= 1) return;
    const newItems = form.items.filter((_, i) => i !== idx);
    setForm(p => ({ ...p, items: newItems, totalAmount: String(newItems.reduce((s, i) => s + i.amount, 0)) }));
    setPriceMeta(previous => previous.filter((_, i) => i !== idx));
  };
  const setRegistrant = (idx: number, key: keyof RegistrantForm, value: string) =>
    setForm(p => ({ ...p, registrants: p.registrants.map((r, i) => (i === idx ? { ...r, [key]: value } : r)) }));

  /** 表單內容 → 要送給伺服器的欄位（欄位名稱與格式跟 PATCH /api/sales-orders/:id 一樣） */
  const valuesOf = (f: SalesOrderForm): Record<string, unknown> => {
    const fields = ((templateOf(f.templateId)?.fieldSchema || []) as FieldDef[]);
    const extra: Record<string, unknown> = { ...extraBase.current };
    for (const fd of fields) {
      if (COLUMN_FIELDS.has(fd.name)) continue;
      const v = String(f.extraFields[fd.name] ?? "").trim();
      if (v === "") delete extra[fd.name]; else extra[fd.name] = fd.type === "number" ? Number(v) : v;
    }
    return {
      customerId: Number(f.customerId),
      orderDate: f.orderDate,
      deliveryDate: f.deliveryDate,
      items: f.items.map(line => ({ itemId: line.itemId ?? null, code: line.code || "", itemName: line.itemName, quantity: Number(line.quantity) || 0, unit: line.unit || "", rate: Number(line.rate) || 0, amount: Number(line.amount) || 0, summary: line.summary || "" })),
      departmentId: f.departmentId ? Number(f.departmentId) : null,
      projectId: f.projectId ? Number(f.projectId) : null,
      templateId: f.templateId ? Number(f.templateId) : null,
      orderSource: f.orderSource || "manual",
      extraFields: extra,
      label: f.label,
      handlerId: f.handlerId ? Number(f.handlerId) : null,
      classWeeks: f.classWeeks === "" ? null : Number(f.classWeeks),
      courseStartDate: f.courseStartDate, courseEndDate: f.courseEndDate, caseTime: f.caseTime,
      teacherCode: f.teacherCode,
      teacherFeePerSession: f.teacherFeePerSession === "" ? null : Number(f.teacherFeePerSession),
      teacherMaterialFeeMethod: f.teacherMaterialFeeMethod,
      coursePeriod: f.coursePeriod, warehouseCode: f.warehouseCode, transactionType: f.transactionType,
      dateDetails: f.dateDetails, remarks: f.remarks,
      invoiceTaxId: f.invoiceTaxId?.trim() || null,
      invoiceTitle: f.invoiceTitle?.trim() || null,
    };
  };

  /** 報名人員：新加的新增、改過的更新、拿掉的刪除 */
  const registrantChanges = () => {
    const kept = new Set(form.registrants.filter(r => r.id).map(r => r.id));
    const removed = originalRegistrants.current.filter(r => r.id && !kept.has(r.id));
    const added = form.registrants.filter(r => !r.id && r.name.trim());
    const edited = form.registrants.filter(r => {
      if (!r.id || !r.name.trim()) return false;
      const before = originalRegistrants.current.find(o => o.id === r.id);
      return !!before && JSON.stringify(before) !== JSON.stringify(r);
    });
    return { removed, added, edited };
  };
  const saveRegistrants = async (orderId: number) => {
    const { removed, added, edited } = registrantChanges();
    const json = { "Content-Type": "application/json" };
    for (const r of removed) await fetch(`/erp-api/registrants/${r.id}`, { method: "DELETE" });
    for (const { id, ...rest } of edited) await fetch(`/erp-api/registrants/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(rest) });
    for (const { id: _id, ...rest } of added) await fetch(`/erp-api/sales-orders/${orderId}/registrants`, { method: "POST", headers: json, body: JSON.stringify(rest) });
  };

  const handleSave = async () => {
    if (full) {
      if (!form.customerId || !form.orderDate) { toast({ title: "請填寫客戶與日期", variant: "destructive" }); return; }
      if (!form.departmentId || !form.projectId) { toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return; }
      const missing = schema.filter(fd => fd.required && isBlank(COLUMN_FIELDS.has(fd.name) ? (form as any)[fd.name] : form.extraFields[fd.name])).map(fd => fd.label || fd.name);
      if (missing.length > 0) { toast({ title: "模板必填欄位尚未填寫", description: missing.join("、"), variant: "destructive" }); return; }
    } else if (mode === "legacy" && !form.projectId) {
      toast({ title: "請選擇專案", description: "每一筆收入與支出都必須歸屬到專案", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const values = valuesOf(form);
      let orderId: number | undefined = order?.id;
      let pending = false;
      let pendingText = "";
      if (!order) {
        // 伺服器新增時會檢查模板必填欄位：存在單據本身欄位的那幾個也抄一份到 extraFields
        const extra = { ...(values.extraFields as Record<string, unknown>) };
        for (const fd of columnSchema) if (fd.required && !isBlank((form as any)[fd.name])) extra[fd.name] = String((form as any)[fd.name]).trim();
        const payload: Record<string, unknown> = { ...values, extraFields: extra, orderNumber: form.orderNumber, status: "Draft", totalAmount: form.totalAmount };
        // 新增時統編、抬頭沒填就不送（新增的格式不收空值）
        if (payload.invoiceTaxId === null) delete payload.invoiceTaxId;
        if (payload.invoiceTitle === null) delete payload.invoiceTitle;
        const res = await fetch(`/erp-api/sales-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "建立失敗");
        orderId = body.id;
      } else {
        // 內容與狀態要分開送，所以這裡不送狀態。
        // 草稿整張送；已成立的單與歷史單只送「可以改、而且真的有改」的欄位，沒動到的不會被送審，也不會碰到鎖住的欄位。
        let payload = values;
        if (!full) {
          const before = valuesOf(initialForm.current);
          payload = Object.fromEntries(Object.entries(values).filter(([key, value]) => can(key) && JSON.stringify(value) !== JSON.stringify(before[key])));
        }
        const regs = registrantChanges();
        const registrantsChanged = regs.removed.length + regs.added.length + regs.edited.length > 0;
        if (Object.keys(payload).length === 0 && !registrantsChanged) {
          toast({ title: "沒有改到任何內容" });
          onOpenChange(false);
          return;
        }
        if (Object.keys(payload).length > 0) {
          const res = await fetch(`/erp-api/sales-orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            // 已入帳的單：這次修改已送審、還沒生效。不是失敗，照樣關視窗並重新讀資料
            if (body?.pending) { pending = true; pendingText = body.error || body.message || ""; }
            else throw new Error(body.error || "儲存失敗");
          }
        }
      }
      if (orderId) await saveRegistrants(orderId);
      if (pending) toast({ title: "已送審，還沒生效", description: pendingText || "財務或超級管理員核准後才會改" });
      else toast({ title: order ? "訂單已更新" : "訂單已建立" });
      onOpenChange(false);
      onSaved?.({ id: orderId, pending });
    } catch (err: any) {
      toast({ title: "沒有成功", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const itemOptions = useMemo(() => catalogItems.map((c: any) => ({ value: c.itemCode, label: `${c.itemCode} ${c.itemName}` })), [catalogItems]);
  const statusLabel = STATUS_LABEL[form.status] || form.status;

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name={order ? "編輯銷貨單" : "新增銷貨單"}
      number={order?.orderNumber}
      status={<>
        <Badge variant={form.status === "Completed" ? "default" : form.status === "Cancelled" ? "destructive" : "secondary"}>{order ? statusLabel : "草稿"}</Badge>
        {isLegacy && <Badge variant="outline" className="font-normal text-muted-foreground">歷史</Badge>}
      </>}
      extraWide
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={handleSave} disabled={saving} data-testid="button-save-order-edit">{saving ? "儲存中…" : order ? "更新" : "建立"}</Button>
      </>}
    >
        <div className="space-y-5">
          {mode === "legacy" && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              這是從舊系統 Ecount 搬過來的歷史銷貨單{order?.extraFields?.legacyDocNumber ? `（原單號 ${order.extraFields.legacyDocNumber}）` : ""}。可以補標題、分類、專案、部門、承辦人、備註、課程與開票資訊；金額、品項、客戶、日期不能改，因為帳已經入過了。
            </p>
          )}
          {mode === "posted" && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              這張單已經成立，這裡可以補標題、分類、承辦人、備註、課程與開票資訊。品項、金額、客戶、日期、專案、部門要改，請先把訂單退回草稿。
            </p>
          )}

          <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
            {TABS.map(t => (
              <button
                key={t}
                type="button"
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => set("template", t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><Label htmlFor="so-edit-number">銷貨單號</Label><Input id="so-edit-number" value={order ? form.orderNumber : ""} placeholder="建立後自動編號" disabled readOnly /></div>
            <div><Label htmlFor="so-edit-date">日期 *</Label><Input id="so-edit-date" type="date" value={form.orderDate} onChange={e => set("orderDate", e.target.value)} {...lock("orderDate")} /></div>
            <div><Label>客戶 *</Label>
              <SearchableSelect
                value={form.customerId}
                onValueChange={(v) => {
                  const cust = customers.find((c: any) => String(c.id) === String(v));
                  setForm(p => ({
                    ...p,
                    customerId: v,
                    invoiceTaxId: p.invoiceTaxId?.trim() ? p.invoiceTaxId : (cust?.customerCode || cust?.taxId || ""),
                    invoiceTitle: p.invoiceTitle?.trim() ? p.invoiceTitle : (cust?.name || ""),
                  }));
                  form.items.forEach((line, idx) => {
                    if (line.itemId && !priceMeta[idx]?.touched) void resolveItemPrice(idx, line.itemId, v, line.quantity);
                  });
                }}
                options={[
                  ...customers.map((c: any) => ({ value: String(c.id), label: `${c.customerCode ? `[${c.customerCode}] ` : ""}${c.name}` })),
                  // 客戶清單還沒讀到（或客戶已不在清單）時，先顯示單據上的客戶名稱
                  ...(order && form.customerId && !customers.some((c: any) => String(c.id) === form.customerId) ? [{ value: form.customerId, label: order.customerName || form.customerId }] : []),
                ]}
                placeholder="請選擇客戶"
                searchPlaceholder="輸入客戶名稱或編號搜尋..."
                emptyText="找不到客戶"
                data-testid="select-order-customer"
                {...lock("customerId")}
              />
            </div>
            <div>
              <Label>狀態</Label>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{order ? statusLabel : "草稿"}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {order ? "狀態不在這裡改；要成立或取消訂單，請用銷貨單明細頁上方的按鈕。" : "建立後再依流程推進；完成狀態由出貨，或純虛擬服務的發票收款結果確認。"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label htmlFor="so-edit-label">標題（標籤）</Label>
              <Input id="so-edit-label" value={form.label} onChange={e => set("label", e.target.value)} placeholder="例：114(下)東湖_魔法秘密學院_訂購單(0122)" {...lock("label")} />
            </div>
            <div>
              <Label htmlFor="so-edit-template">分類（套用模板）</Label>
              <select id="so-edit-template" className={selectClass} value={form.templateId} onChange={e => applyTemplate(e.target.value)} {...lock("templateId")}>
                <option value="">未分類（不使用模板）</option>
                {availableTemplates.map(t => <option key={t.id} value={String(t.id)}>{t.name}{t.isActive ? "" : "（已停用）"}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="so-edit-source">訂單來源</Label>
              <select id="so-edit-source" className={selectClass} value={form.orderSource} onChange={e => set("orderSource", e.target.value)} {...lock("orderSource")}>
                {/* 「Ecount 歷史單」只有搬家進來的單才會是，不能自己選 */}
                {Object.entries(SOURCE_LABELS).filter(([k]) => k !== "ecount" || form.orderSource === "ecount").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                {!SOURCE_LABELS[form.orderSource] && <option value={form.orderSource}>{form.orderSource}</option>}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><Label>承辦人</Label>
              <LookupSelect className={selectClass} value={form.handlerId} onChange={e => set("handlerId", e.target.value)} {...lock("handlerId")}>
                <option value="">請選擇</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{empName(e)}{e.status && e.status !== "Active" ? "（已離職）" : ""}</option>)}
              </LookupSelect>
              {!form.handlerId && order?.extraFields?.legacyStaff && <p className="mt-1 text-xs text-muted-foreground">舊系統的承辦人：{order.extraFields.legacyStaff}</p>}
            </div>
            <div><Label>專案 {(full || mode === "legacy") && <span className="text-red-500">*</span>}</Label>
              <SearchableSelect
                value={form.projectId}
                onValueChange={projectId => {
                  setForm(p => {
                    const templateAvailable = !p.templateId || templates.some(t =>
                      t.id === Number(p.templateId) && t.isActive && (t.projectId == null || String(t.projectId) === projectId)
                    );
                    return { ...p, projectId, templateId: templateAvailable ? p.templateId : "", extraFields: templateAvailable ? p.extraFields : {} };
                  });
                }}
                options={[
                  ...projects.filter((p: any) => p.isActive !== false || String(p.id) === String(form.projectId)).map((p: any) => ({ value: String(p.id), label: `${p.name}${p.isActive === false ? "（已停用）" : ""}` })),
                ]}
                placeholder="請選擇專案"
                triggerClassName={can("projectId") && !form.projectId ? "border-red-300 bg-red-50" : undefined}
                data-testid="select-order-project"
                {...lock("projectId")}
              />
            </div>
            <div><Label>部門 {full && <span className="text-red-500">*</span>}</Label>
              <SearchableSelect
                value={form.departmentId}
                onValueChange={v => set("departmentId", v)}
                options={[
                  // 歷史單的部門可以不指定
                  ...(mode === "legacy" ? [{ value: "", label: "（不指定）" }] : []),
                  ...departments.filter((d: any) => d.isActive !== false || String(d.id) === String(form.departmentId)).map((d: any) => ({ value: String(d.id), label: `${d.name}${d.isActive === false ? "（已停用）" : ""}` })),
                ]}
                placeholder={mode === "legacy" ? "（不指定）" : "請選擇部門"}
                triggerClassName={full && !form.departmentId ? "border-red-300 bg-red-50" : undefined}
                data-testid="select-order-department"
                {...lock("departmentId")}
              />
            </div>
            <div><Label>發貨倉庫</Label>
              <LookupSelect className={selectClass} value={form.warehouseCode} onChange={e => set("warehouseCode", e.target.value)} {...lock("warehouseCode")}>
                <option value="">請選擇</option>
                {warehouses.map((w: any) => <option key={w.id} value={w.warehouseCode || w.name}>{w.warehouseCode ? `[${w.warehouseCode}] ` : ""}{w.name}</option>)}
                {form.warehouseCode && !warehouses.some((w: any) => (w.warehouseCode || w.name) === form.warehouseCode) && <option value={form.warehouseCode}>{form.warehouseCode}</option>}
              </LookupSelect>
            </div>
          </div>

          {selectedTemplate && extraSchema.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="mb-3 text-sm font-semibold text-blue-600">模板欄位：{selectedTemplate.name}</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {extraSchema.map(fd => {
                  const value = form.extraFields[fd.name] ?? "";
                  const change = (v: string) => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [fd.name]: v } }));
                  return (
                    <div key={fd.name}>
                      <Label htmlFor={`so-extra-${fd.name}`}>{fd.label}{fd.required && <span className="ml-0.5 text-red-500">*</span>}</Label>
                      {fd.type === "select" ? (
                        <select id={`so-extra-${fd.name}`} className={selectClass} value={value} onChange={e => change(e.target.value)} {...lock("extraFields")}>
                          <option value="">請選擇</option>
                          {(fd.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                          {value && !(fd.options || []).includes(value) && <option value={value}>{value}</option>}
                        </select>
                      ) : fd.type === "textarea" ? (
                        <Textarea id={`so-extra-${fd.name}`} rows={2} value={value} onChange={e => change(e.target.value)} {...lock("extraFields")} />
                      ) : (
                        <Input id={`so-extra-${fd.name}`} type={fd.type === "number" ? "number" : fd.type === "date" ? "date" : "text"} inputMode={fd.type === "number" ? "decimal" : undefined} value={value} onChange={e => change(e.target.value)} {...lock("extraFields")} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showCourse && (
            <div className="border-t pt-4">
              <h4 className="mb-3 text-sm font-semibold text-gray-600">{homeService ? "居家服務資訊" : "課程資訊"}</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div><Label htmlFor="so-edit-start">{homeService ? "服務開始日" : "開課日期"}{star("courseStartDate")}</Label><Input id="so-edit-start" type="date" value={form.courseStartDate} onChange={e => set("courseStartDate", e.target.value)} {...lock("courseStartDate")} /></div>
                <div><Label htmlFor="so-edit-end">{homeService ? "服務結束日" : "課程截止日"}{star("courseEndDate")}</Label><Input id="so-edit-end" type="date" value={form.courseEndDate} onChange={e => set("courseEndDate", e.target.value)} {...lock("courseEndDate")} /></div>
                <div><Label htmlFor="so-edit-weeks">{homeService ? "服務次數" : "上課週次"}{star("classWeeks")}</Label><Input id="so-edit-weeks" type="number" inputMode="numeric" min="0" value={form.classWeeks} onChange={e => set("classWeeks", e.target.value)} placeholder={homeService ? "例：12" : "例：18"} {...lock("classWeeks")} /></div>
                <div><Label htmlFor="so-edit-time">{homeService ? "服務時間" : "上課時間"}{star("caseTime")}</Label><Input id="so-edit-time" value={form.caseTime} onChange={e => set("caseTime", e.target.value)} placeholder={homeService ? "例：09:00-12:00" : "例：16:00-17:30"} {...lock("caseTime")} /></div>
                <div><Label>{homeService ? "服務人員" : "老師"}{star("teacherCode")}</Label>
                  <LookupSelect className={selectClass} value={form.teacherCode} onChange={e => set("teacherCode", e.target.value)} {...lock("teacherCode")}>
                    <option value="">{homeService ? "請選擇" : "請選擇老師"}</option>
                    {teachers.map((t: any) => <option key={t.id} value={t.teacherCode}>{t.teacherCode ? `[${t.teacherCode}] ` : ""}{t.name}</option>)}
                    {/* 歷史單的老師可能不在老師名單裡，照原本的內容顯示 */}
                    {form.teacherCode && !teachers.some((t: any) => t.teacherCode === form.teacherCode) && <option value={form.teacherCode}>{form.teacherCode}</option>}
                  </LookupSelect>
                </div>
                <div><Label htmlFor="so-edit-fee">{homeService ? "服務費用／次" : "講師費用／次"}{star("teacherFeePerSession")}</Label><Input id="so-edit-fee" type="number" inputMode="decimal" min="0" value={form.teacherFeePerSession} onChange={e => set("teacherFeePerSession", e.target.value)} placeholder="例：900" {...lock("teacherFeePerSession")} /></div>
                <div><Label htmlFor="so-edit-material">老師酌收材料費方式{star("teacherMaterialFeeMethod")}</Label>
                  <select id="so-edit-material" className={selectClass} value={form.teacherMaterialFeeMethod} onChange={e => set("teacherMaterialFeeMethod", e.target.value)} {...lock("teacherMaterialFeeMethod")}>
                    {(!full || !form.teacherMaterialFeeMethod) && <option value="">（未填）</option>}
                    {MATERIAL_FEE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    {form.teacherMaterialFeeMethod && !MATERIAL_FEE_OPTIONS.includes(form.teacherMaterialFeeMethod) && <option value={form.teacherMaterialFeeMethod}>{form.teacherMaterialFeeMethod}</option>}
                  </select>
                </div>
                <div><Label htmlFor="so-edit-period">課程期數{star("coursePeriod")}</Label><Input id="so-edit-period" value={form.coursePeriod} onChange={e => set("coursePeriod", e.target.value)} placeholder="例：26Q3 / 114下" {...lock("coursePeriod")} /></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-4">
            <div><Label htmlFor="so-edit-tax-type">交易類型</Label>
              <select id="so-edit-tax-type" className={selectClass} value={form.transactionType} onChange={e => set("transactionType", e.target.value)} {...lock("transactionType")}>
                {!form.transactionType && <option value="">（未填）</option>}
                {TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                {form.transactionType && !TRANSACTION_TYPES.includes(form.transactionType) && <option value={form.transactionType}>{form.transactionType}</option>}
              </select>
            </div>
            <div><Label htmlFor="so-edit-delivery">預計交貨日{star("deliveryDate")}</Label><Input id="so-edit-delivery" type="date" value={form.deliveryDate} onChange={e => set("deliveryDate", e.target.value)} {...lock("deliveryDate")} /></div>
            <div className="md:col-span-2"><Label htmlFor="so-edit-dates">日期詳情{star("dateDetails")}</Label><Textarea id="so-edit-dates" rows={1} className="min-h-10" value={form.dateDetails} onChange={e => set("dateDetails", e.target.value)} {...lock("dateDetails")} /></div>
          </div>

          <div><Label htmlFor="so-edit-remarks">備註{star("remarks")}</Label>
            <Textarea id="so-edit-remarks" rows={3} value={form.remarks} onChange={e => set("remarks", e.target.value)} placeholder="學生數:18 材料數:20" {...lock("remarks")} />
          </div>

          <div className="border-t pt-4">
            <h4 className="mb-3 text-sm font-semibold text-gray-600">開票資訊</h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><Label htmlFor="so-edit-tax-id">統編</Label><Input id="so-edit-tax-id" value={form.invoiceTaxId} onChange={e => set("invoiceTaxId", e.target.value)} placeholder="預設帶入客戶編號（通常為統編），可手動修改" {...lock("invoiceTaxId")} /></div>
              <div><Label htmlFor="so-edit-tax-title">抬頭</Label><Input id="so-edit-tax-title" value={form.invoiceTitle} onChange={e => set("invoiceTitle", e.target.value)} placeholder="預設帶入客戶名稱，可手動修改" {...lock("invoiceTitle")} /></div>
            </div>
          </div>

          <div className="border-t pt-4 scroll-mt-4" ref={itemsRef} data-testid="order-items-section">
            {/* 品項不能改的單：整區鎖住，內容照樣看得到 */}
            <fieldset disabled={!can("items")} className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-base font-semibold">品項明細</Label>
                {can("items")
                  ? <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus size={14} className="mr-1" />新增項目</Button>
                  : <span className="text-xs text-muted-foreground">{mode === "legacy" ? "歷史單的品項與金額不能改" : "已成立的單要先退回草稿才能改品項"}</span>}
              </div>
              {/* 手機版：卡片式品項編輯 */}
              <div className="space-y-3 md:hidden">
                {form.items.map((item, idx) => (
                  <div key={idx} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">項目 {idx + 1}</span>
                      {can("items") && form.items.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(idx)} aria-label={`刪除項目 ${idx + 1}`}><Trash2 size={14} /></Button>
                      )}
                    </div>
                    <SearchableSelect value={item.code || ""} onValueChange={(code) => handleItemCodeChange(idx, code)} options={itemOptions} placeholder="選擇品項編號" searchPlaceholder="輸入編號或名稱搜尋..." emptyText="找不到品項" disabled={!can("items")} />
                    <Input placeholder="品項名稱" value={item.itemName} onChange={e => updateItem(idx, "itemName", e.target.value)} />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} /></div>
                      <div><Label className="text-xs text-muted-foreground">單位</Label><Input value={item.unit || ""} onChange={e => updateItem(idx, "unit", e.target.value)} /></div>
                      <div><Label className="text-xs text-muted-foreground">單價</Label><Input type="number" min={0} value={item.rate} onChange={e => updateItem(idx, "rate", Number(e.target.value))} /></div>
                    </div>
                    {can("items") && priceMeta[idx]?.source && <div className="text-[11px] text-muted-foreground">{priceMeta[idx].source}</div>}
                    {lineWarnings[idx] && <div className="text-xs font-medium text-amber-700">{lineWarnings[idx]}</div>}
                    <Input placeholder="摘要／備註" value={item.summary || ""} onChange={e => updateItem(idx, "summary", e.target.value)} />
                    <div className="text-right text-sm font-medium">小計：${(item.amount || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              {/* 桌面版：表格式品項編輯 */}
              <div className="hidden min-w-0 overflow-x-auto md:block">
                <table className="w-full min-w-[1000px] table-fixed text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="w-44 px-2 py-2 text-left font-medium">品項編號</th>
                      <th className="min-w-[140px] px-2 py-2 text-left font-medium">品項名稱</th>
                      <th className="w-32 px-2 py-2 text-left font-medium">數量</th>
                      <th className="w-24 px-2 py-2 text-left font-medium">單位</th>
                      <th className="w-40 px-2 py-2 text-left font-medium">單價</th>
                      <th className="w-32 px-2 py-2 text-right font-medium">小計</th>
                      <th className="w-40 px-2 py-2 text-left font-medium">摘要（備註）</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="px-1.5 py-1.5">
                          <SearchableSelect value={item.code || ""} onValueChange={(code) => handleItemCodeChange(idx, code)} options={itemOptions} placeholder="選擇編號" searchPlaceholder="輸入編號或名稱搜尋..." emptyText="找不到品項" disabled={!can("items")} />
                        </td>
                        <td className="px-1.5 py-1.5"><Input placeholder="品項名稱" value={item.itemName} onChange={e => updateItem(idx, "itemName", e.target.value)} className="h-10 px-2 text-base" /></td>
                        <td className="px-1.5 py-1.5"><Input type="number" min={1} inputMode="decimal" step="any" value={item.quantity === 0 ? "" : item.quantity} placeholder="0" onChange={e => updateItem(idx, "quantity", Number(e.target.value))} className={numberInputClass} /></td>
                        <td className="px-1.5 py-1.5"><Input value={item.unit || ""} onChange={e => updateItem(idx, "unit", e.target.value)} className="h-10 px-2 text-base" /></td>
                        <td className="px-1.5 py-1.5">
                          <Input type="number" min={0} inputMode="decimal" step="any" value={item.rate === 0 ? "" : item.rate} placeholder="0" onChange={e => updateItem(idx, "rate", Number(e.target.value))} className={numberInputClass} />
                          {can("items") && priceMeta[idx]?.source && <div className="mt-0.5 text-[11px] text-muted-foreground">{priceMeta[idx].source}</div>}
                          {lineWarnings[idx] && <div className="mt-1 text-xs font-medium text-amber-700">{lineWarnings[idx]}</div>}
                        </td>
                        <td className="px-1.5 py-1.5 text-right font-medium">${(item.amount || 0).toLocaleString()}</td>
                        <td className="px-1.5 py-1.5"><Input placeholder="摘要／備註" value={item.summary || ""} onChange={e => updateItem(idx, "summary", e.target.value)} className="h-10 px-2 text-base" /></td>
                        <td className="px-1 py-1.5">
                          {can("items") && form.items.length > 1 && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(idx)} aria-label={`刪除項目 ${idx + 1}`}><Trash2 size={14} /></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-right font-bold">合計：${Number(form.totalAmount).toLocaleString()}</div>
            </fieldset>
          </div>

          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-base font-semibold">報名人員</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setForm(p => ({ ...p, registrants: [...p.registrants, { name: "", contactInfo: "", age: "", grade: "", notes: "" }] }))}>
                <Plus size={14} className="mr-1" />新增報名者
              </Button>
            </div>
            {form.registrants.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚無報名人員（可選填）</p>
            ) : (
              <div className="space-y-2">
                {form.registrants.map((reg, idx) => (
                  <div key={reg.id ?? `new-${idx}`} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-12 md:border-0 md:p-0">
                    <Input className="col-span-2 md:col-span-3" placeholder="姓名 *" value={reg.name} onChange={e => setRegistrant(idx, "name", e.target.value)} />
                    <Input className="col-span-2 md:col-span-2" placeholder="聯絡方式" value={reg.contactInfo} onChange={e => setRegistrant(idx, "contactInfo", e.target.value)} />
                    <Input className="col-span-1 md:col-span-2" placeholder="年齡" value={reg.age} onChange={e => setRegistrant(idx, "age", e.target.value)} />
                    <Input className="col-span-1 md:col-span-2" placeholder="年級" value={reg.grade} onChange={e => setRegistrant(idx, "grade", e.target.value)} />
                    <Input className="col-span-2 md:col-span-2" placeholder="備註" value={reg.notes} onChange={e => setRegistrant(idx, "notes", e.target.value)} />
                    <Button variant="ghost" size="icon" className="col-span-2 justify-self-end md:col-span-1" onClick={() => setForm(p => ({ ...p, registrants: p.registrants.filter((_, i) => i !== idx) }))} aria-label={`刪除報名者 ${idx + 1}`}><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </DocWindow>
  );
}
