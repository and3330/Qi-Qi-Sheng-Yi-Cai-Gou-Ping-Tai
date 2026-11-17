import { useState, useEffect, useCallback } from "react";
import { templateMeta, type TemplateMeta } from "@/lib/template-fields";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, GripVertical, Eye, Layers, Zap } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { MultiSearchSelect } from "@/components/shared/multi-search-select";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  required: boolean;
  options?: string[];
  defaultValue?: string;
}

interface Template {
  id: number;
  name: string;
  projectId: number | null;
  businessType: string;
  description: string | null;
  fieldSchema: FieldDef[];
  defaultValues: Record<string, any>;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

const BUSINESS_TYPES = [
  { value: "ecommerce", label: "商城電商" },
  { value: "campus", label: "校園業務" },
  { value: "event", label: "活動業務" },
  { value: "home_service", label: "居家服務" },
  { value: "other", label: "其他" },
];

const FIELD_TYPES = [
  { value: "text", label: "文字" },
  { value: "number", label: "數字" },
  { value: "date", label: "日期" },
  { value: "select", label: "下拉選單" },
  { value: "textarea", label: "多行文字" },
];

const emptyField: FieldDef = { name: "", label: "", type: "text", required: false };

export default function OrderTemplatesPage() {
  const reloadKey = useAutoReloadKey();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("other");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formProjectId, setFormProjectId] = useState("global");
  const [formFields, setFormFields] = useState<FieldDef[]>([]);
  const [formAppliesTo, setFormAppliesTo] = useState<TemplateMeta["appliesTo"]>("both");
  const [formItemGroups, setFormItemGroups] = useState<string[]>([]);
  const [itemGroupOptions, setItemGroupOptions] = useState<string[]>([]);

  // 品項分類清單：用來設定「有這類品項就自動帶出這個模板」
  useEffect(() => {
    fetch(api("items"))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const groups = Array.isArray(rows) ? rows.map((row: any) => row.itemGroup).filter((g: unknown): g is string => typeof g === "string" && g !== "") : [];
        setItemGroupOptions([...new Set<string>(groups)].sort());
      })
      .catch(() => {});
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api("order-templates"));
      setTemplates(await res.json());
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetch(api("projects")).then(r => r.json()).then(setProjects).catch(() => {});
  }, [fetchTemplates, reloadKey]);

  const openCreate = () => {
    setEditing(null);
    setFormName(""); setFormType("other"); setFormDesc(""); setFormActive(true);
    setFormProjectId("global");
    setFormFields([{ ...emptyField }]);
    setFormAppliesTo("both"); setFormItemGroups([]);
    setOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setFormName(t.name);
    setFormType(t.businessType);
    setFormDesc(t.description || "");
    setFormActive(t.isActive);
    setFormProjectId(t.projectId == null ? "global" : String(t.projectId));
    setFormFields(t.fieldSchema.length > 0 ? t.fieldSchema.map(f => ({ ...f })) : [{ ...emptyField }]);
    const meta = templateMeta(t);
    setFormAppliesTo(meta.appliesTo); setFormItemGroups(meta.itemGroups);
    setOpen(true);
  };

  const addField = () => setFormFields(p => [...p, { ...emptyField }]);
  const removeField = (idx: number) => setFormFields(p => p.filter((_, i) => i !== idx));
  const updateField = (idx: number, key: keyof FieldDef, value: any) => {
    setFormFields(p => {
      const n = [...p];
      (n[idx] as any)[key] = value;
      return n;
    });
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= formFields.length) return;
    setFormFields(p => {
      const n = [...p];
      [n[idx], n[newIdx]] = [n[newIdx], n[idx]];
      return n;
    });
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: "請輸入模板名稱", variant: "destructive" }); return; }
    const validFields = formFields.filter(f => f.name.trim() && f.label.trim());
    const payload = {
      name: formName.trim(),
      businessType: formType,
      description: formDesc.trim() || null,
      projectId: formProjectId === "global" ? null : Number(formProjectId),
      fieldSchema: validFields,
      defaultValues: { __meta: { appliesTo: formAppliesTo, itemGroups: formItemGroups } },
      isActive: formActive,
    };
    try {
      if (editing) {
        const res = await fetch(api(`order-templates/${editing.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error);
        toast({ title: "模板已更新" });
      } else {
        const res = await fetch(api("order-templates"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error);
        toast({ title: "模板已建立" });
      }
      setOpen(false);
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (t: Template) => {
    if (!confirm(`確定刪除模板「${t.name}」？`)) return;
    try {
      const res = await fetch(api(`order-templates/${t.id}`), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "刪除失敗");
      }
      toast({ title: "模板已刪除" });
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const seedDefaults = async () => {
    try {
      const res = await fetch(api("order-templates/seed-defaults"), { method: "POST" });
      const data = await res.json();
      toast({ title: data.message || "預設模板已建立" });
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
    }
  };

  const getTypeLabel = (type: string) => BUSINESS_TYPES.find(t => t.value === type)?.label || type;
  const getProjectName = (projectId: number | null) => {
    if (projectId == null) return "全域";
    return projects.find((p: any) => p.id === projectId)?.name || `專案 #${projectId}`;
  };

  const batch = useBatchSelection(templates);
  const templateBatchFields: BatchField[] = [
    { key: "businessType", label: "業務類型", type: "select", options: BUSINESS_TYPES },
    { key: "isActive", label: "啟用狀態", type: "select", options: [{ value: "true", label: "啟用" }, { value: "false", label: "停用" }] },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">訂單模板管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理不同業務線的訂單模板與自訂欄位</p>
        </div>
        <div className="flex gap-2">
          {templates.length === 0 && (
            <Button variant="outline" onClick={seedDefaults}>
              <Zap size={16} className="mr-1" />建立預設模板
            </Button>
          )}
          <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增模板</Button>
        </div>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="訂單模板"
          entityEndpoint="order-templates"
          ids={batch.ids}
          batchFields={templateBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => { batch.clearSelection(); fetchTemplates(); }}
        />
      )}

      {templates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />
          全選（已選 {batch.count} 筆）
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-32" />
            </Card>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">尚無訂單模板</p>
            <Button className="mt-4" onClick={seedDefaults}><Zap size={16} className="mr-1" />建立四個預設模板</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2">
          {templates.map(t => (
            <Card key={t.id} className={!t.isActive ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <div className="pt-1"><CheckboxCell checked={batch.selectedIds.has(t.id)} onChange={() => batch.toggle(t.id)} /></div>
                    <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {t.name}
                      <Badge variant={t.projectId == null ? "secondary" : "outline"}>{getProjectName(t.projectId)}</Badge>
                      {!t.isActive && <Badge variant="secondary">停用</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1">{t.description || getTypeLabel(t.businessType)}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline">{getTypeLabel(t.businessType)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1 mb-4">
                  {(t.fieldSchema as FieldDef[]).map((f, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </Badge>
                  ))}
                  {(t.fieldSchema as FieldDef[]).length === 0 && (
                    <span className="text-xs text-muted-foreground">無自訂欄位</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setPreviewTemplate(t); setPreviewOpen(true); }}>
                    <Eye size={14} className="mr-1" />預覽
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    <Pencil size={14} className="mr-1" />編輯
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(t)}>
                    <Trash2 size={14} className="mr-1 text-destructive" />刪除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "編輯訂單模板" : "新增訂單模板"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>模板名稱 *</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="例：校園業務" />
              </div>
              <div>
                <Label>業務類型 *</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>說明</Label>
              <Input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="模板用途說明" />
            </div>
            <div>
              <Label>適用單據</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formAppliesTo}
                onChange={e => setFormAppliesTo(e.target.value as TemplateMeta["appliesTo"])}
                data-testid="select-template-applies-to"
              >
                <option value="both">銷售與採購都可以用</option>
                <option value="sales">只用在銷售（報價單、銷售訂單）</option>
                <option value="purchase">只用在採購訂單</option>
              </select>
            </div>
            <div>
              <Label>適用品項分類 <span className="font-normal text-muted-foreground">（選填）</span></Label>
              <p className="mb-1.5 text-xs text-muted-foreground">單據裡只要有這些分類的品項，就會自動帶出這個模板，不用自己選。</p>
              {itemGroupOptions.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">品項還沒有設定分類。到「品項」填好分類後，這裡就能選。</p>
              ) : (
                <MultiSearchSelect
                  options={itemGroupOptions}
                  value={formItemGroups}
                  onChange={setFormItemGroups}
                  placeholder="選擇品項分類（可多選）"
                  searchPlaceholder="搜尋分類…"
                />
              )}
            </div>
            <div>
              <Label>適用專案</Label>
              <Select value={formProjectId} onValueChange={setFormProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全域（所有專案）</SelectItem>
                  {projects.filter((p: any) => p.isActive !== false || String(p.id) === formProjectId).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.isActive === false ? "（已停用）" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formActive} onCheckedChange={setFormActive} />
              <Label>啟用此模板</Label>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-semibold">自訂欄位</Label>
                <Button type="button" variant="outline" size="sm" onClick={addField}><Plus size={14} className="mr-1" />新增欄位</Button>
              </div>
              <div className="space-y-3">
                {formFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2 items-start p-3 border rounded-lg bg-muted/30">
                    <div className="flex flex-col gap-1 pt-2">
                      <button type="button" onClick={() => moveField(idx, -1)} className="text-muted-foreground hover:text-foreground" disabled={idx === 0}>
                        <GripVertical size={14} />
                      </button>
                    </div>
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <Label className="text-xs">欄位名(英文)</Label>
                        <Input value={field.name} onChange={e => updateField(idx, "name", e.target.value)} placeholder="fieldName" className="text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">顯示名稱</Label>
                        <Input value={field.label} onChange={e => updateField(idx, "label", e.target.value)} placeholder="欄位名稱" className="text-sm" />
                      </div>
                      <div>
                        <Label className="text-xs">類型</Label>
                        <Select value={field.type} onValueChange={v => updateField(idx, "type", v)}>
                          <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex items-center gap-1">
                          <Switch checked={field.required} onCheckedChange={v => updateField(idx, "required", v)} />
                          <Label className="text-xs">必填</Label>
                        </div>
                      </div>
                      {field.type === "select" && (
                        <div className="col-span-4">
                          <Label className="text-xs">選項（逗號分隔）</Label>
                          <Input
                            value={(field.options || []).join(", ")}
                            onChange={e => updateField(idx, "options", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                            placeholder="選項1, 選項2, 選項3"
                            className="text-sm"
                          />
                        </div>
                      )}
                      <div className="col-span-4">
                        <Label className="text-xs">預設值（選填，選用模板時自動帶入）</Label>
                        <Input
                          value={field.defaultValue || ""}
                          onChange={e => updateField(idx, "defaultValue", e.target.value)}
                          placeholder={field.type === "date" ? "例如 2026-12-31" : "留空表示不帶入"}
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeField(idx)} className="mt-5">
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave}>{editing ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>模板預覽：{previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground mb-2">
                業務類型：{getTypeLabel(previewTemplate.businessType)}
              </div>
              <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
                <h4 className="font-medium text-sm border-b pb-2">自訂欄位表單預覽</h4>
                {(previewTemplate.fieldSchema as FieldDef[]).length === 0 ? (
                  <p className="text-muted-foreground text-sm">此模板沒有自訂欄位</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(previewTemplate.fieldSchema as FieldDef[]).map((f, i) => (
                      <div key={i}>
                        <Label className="text-sm">
                          {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                        </Label>
                        {f.type === "select" ? (
                          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled>
                            <option>請選擇</option>
                            {(f.options || []).map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : f.type === "textarea" ? (
                          <textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]" disabled placeholder={f.label} />
                        ) : (
                          <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} disabled placeholder={f.label} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
