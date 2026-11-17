import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLayout } from "@/components/layout/app-layout";
import {
  Plus, Search, BarChart3, FileSpreadsheet, Save,
  Maximize2, Minimize2, Settings2, ArrowRightLeft, Trash2, Copy, Upload, CheckCircle2
} from "lucide-react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const STATUS_OPTIONS = ["待確認", "已成交", "已取消"];
const CAMP_STATUS_OPTIONS = ["待確認", "開班成功", "未開班"];
const DEFAULT_CATEGORIES = ["代課", "活動", "營隊", "講座", "研習", "其他"];
const STORAGE_KEY = "erp-quick-entry-v2";
const CATEGORIES_KEY = "erp-quick-entry-categories-v2";
const COLUMNS_KEY = "erp-quick-entry-columns-v2";
const MAPPING_KEY = "erp-quick-entry-mapping-v2";

interface ColumnDef {
  title: string;
  type: "text" | "dropdown" | "calendar" | "numeric";
  source?: string;
  width?: number;
}

interface SheetInfo {
  id: string;
  name: string;
  rows: any[][];
  columns?: ColumnDef[];
}

interface CategoryConfig {
  name: string;
  sheets: SheetInfo[];
  columns: ColumnDef[];
  fieldMapping: FieldMapping;
}

interface FieldMapping {
  schoolNameCol: number;
  dateCol: number;
  timeCol: number;
  instructorCol: number;
  courseItemCol: number;
  amountCol: number;
  statusCol: number;
  notesCol: number;
  mergeRule: string;
  labelCol?: number;
  classWeeksCol?: number;
  courseStartDateCol?: number;
  courseEndDateCol?: number;
  teacherFeeCol?: number;
  materialFeeMethodCol?: number;
  coursePeriodCol?: number;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { title: "學校名稱", type: "dropdown", source: "customers", width: 180 },
  { title: "日期", type: "calendar", width: 120 },
  { title: "時間", type: "text", width: 100 },
  { title: "講師", type: "dropdown", source: "teachers", width: 140 },
  { title: "課程項目", type: "dropdown", source: "items", width: 180 },
  { title: "金額", type: "numeric", width: 110 },
  { title: "狀態", type: "dropdown", source: "status", width: 100 },
  { title: "備註", type: "text", width: 200 },
];

const DEFAULT_MAPPING: FieldMapping = {
  schoolNameCol: 0, dateCol: 1, timeCol: 2, instructorCol: 3,
  courseItemCol: 4, amountCol: 5, statusCol: 6, notesCol: 7,
  mergeRule: "none",
};

const CAMP_COLUMNS: ColumnDef[] = [
  { title: "地點", type: "text", width: 160 },
  { title: "營隊課程", type: "text", width: 160 },
  { title: "地址", type: "text", width: 220 },
  { title: "開課日期", type: "text", width: 100 },
  { title: "截止日期", type: "text", width: 100 },
  { title: "費用", type: "numeric", width: 100 },
  { title: "班級人數", type: "numeric", width: 80 },
  { title: "主講數量", type: "numeric", width: 80 },
  { title: "助教數量", type: "numeric", width: 80 },
  { title: "主講薪資(元/天)", type: "numeric", width: 120 },
  { title: "助教薪資(元/天)", type: "numeric", width: 120 },
  { title: "場地費(元/天)", type: "numeric", width: 110 },
  { title: "備註", type: "text", width: 120 },
  { title: "派案主講", type: "dropdown", source: "teachers", width: 120 },
  { title: "助教1", type: "dropdown", source: "teachers", width: 120 },
  { title: "助教2", type: "dropdown", source: "teachers", width: 120 },
  { title: "助教3", type: "dropdown", source: "teachers", width: 120 },
  { title: "成本", type: "numeric", width: 110 },
  { title: "收費", type: "numeric", width: 110 },
  { title: "利潤", type: "numeric", width: 110 },
  { title: "開課狀態", type: "dropdown", source: "camp_status", width: 100 },
];

const CAMP_MAPPING: FieldMapping = {
  schoolNameCol: 0, dateCol: 3, timeCol: 4, instructorCol: 13,
  courseItemCol: 1, amountCol: 18, statusCol: 20, notesCol: 12,
  mergeRule: "none",
};

const CATEGORY_DEFAULTS: Record<string, { columns: ColumnDef[]; mapping: FieldMapping }> = {
  "營隊": { columns: CAMP_COLUMNS, mapping: CAMP_MAPPING },
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSVContent(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === '\n' || (ch === '\r' && clean[i + 1] === '\n')) {
        rows.push(parseCSVLine(current));
        current = "";
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }
  if (current.trim()) rows.push(parseCSVLine(current));
  return rows.filter(r => r.some(c => c.trim()));
}

function cleanNTDollar(val: string): string {
  if (!val) return "";
  const cleaned = val.replace(/^NT\$/, "").replace(/^-NT\$/, "-").replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? val : String(num);
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function loadAll(): { categories: string[]; configs: Record<string, CategoryConfig> } {
  try {
    const cats = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || "null") || [...DEFAULT_CATEGORIES];
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
    const cols = JSON.parse(localStorage.getItem(COLUMNS_KEY) || "null") || {};
    const maps = JSON.parse(localStorage.getItem(MAPPING_KEY) || "null") || {};

    const configs: Record<string, CategoryConfig> = {};
    for (const cat of cats) {
      const savedSheets = raw[cat] || [];
      const sheets: SheetInfo[] = savedSheets.length > 0
        ? savedSheets
        : [{ id: genId(), name: "Sheet1", rows: [] }];
      const catDefaults = CATEGORY_DEFAULTS[cat];
      let savedCols = cols[cat];
      let savedMap = maps[cat];
      if (catDefaults && savedCols) {
        const defaultTitles = DEFAULT_COLUMNS.map(c => c.title);
        const savedTitles = savedCols.map((c: ColumnDef) => c.title);
        const isOldDefault = savedTitles.length === defaultTitles.length &&
          savedTitles.every((t: string, i: number) => t === defaultTitles[i]);
        if (isOldDefault) { savedCols = null; savedMap = null; }
      }
      configs[cat] = {
        name: cat,
        sheets,
        columns: savedCols || (catDefaults ? catDefaults.columns.map(c => ({ ...c })) : [...DEFAULT_COLUMNS]),
        fieldMapping: savedMap || (catDefaults ? { ...catDefaults.mapping } : { ...DEFAULT_MAPPING }),
      };
    }
    return { categories: cats, configs };
  } catch {
    return { categories: [...DEFAULT_CATEGORIES], configs: {} };
  }
}

function saveAll(categories: string[], configs: Record<string, CategoryConfig>) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  const data: Record<string, SheetInfo[]> = {};
  const cols: Record<string, ColumnDef[]> = {};
  const maps: Record<string, FieldMapping> = {};
  for (const [cat, cfg] of Object.entries(configs)) {
    data[cat] = cfg.sheets;
    cols[cat] = cfg.columns;
    maps[cat] = cfg.fieldMapping;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  localStorage.setItem(COLUMNS_KEY, JSON.stringify(cols));
  localStorage.setItem(MAPPING_KEY, JSON.stringify(maps));
}

export default function QuickEntry() {
  const { toast } = useToast();
  const { sidebarCollapsed, setSidebarCollapsed } = useLayout();
  const spreadsheetRef = useRef<HTMLDivElement>(null);
  const jssRef = useRef<any>(null);

  const initial = loadAll();
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [configs, setConfigs] = useState<Record<string, CategoryConfig>>(initial.configs);
  const [activeCategory, setActiveCategory] = useState(initial.categories[0] || "代課");
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedRow, setSelectedRow] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [showMappingConfig, setShowMappingConfig] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [newSheetName, setNewSheetName] = useState("");
  const [editingColumns, setEditingColumns] = useState<ColumnDef[]>([]);
  const [editingMapping, setEditingMapping] = useState<FieldMapping>({ ...DEFAULT_MAPPING });

  // 轉出的訂單都要歸屬專案；選過的專案記在這台裝置上，下次不用重選
  const [quickProjectId, setQuickProjectId] = useState<string>(() => {
    try { return localStorage.getItem("erp-quick-entry-project") || ""; } catch { return ""; }
  });
  const quickProjectRef = useRef(quickProjectId);
  quickProjectRef.current = quickProjectId;
  const { data: projectList = [] } = useQuery<any[]>({
    queryKey: ["projects-list"],
    queryFn: () => fetch(api("projects")).then(r => r.json()),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-list"],
    queryFn: () => fetch(api("customers")).then(r => r.json()),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: () => fetch(api("teachers")).then(r => r.json()),
  });
  const { data: items = [] } = useQuery({
    queryKey: ["items-list"],
    queryFn: () => fetch(api("items")).then(r => r.json()),
  });
  const { data: backendTemplates = [] } = useQuery({
    queryKey: ["order-templates"],
    queryFn: () => fetch(api("order-templates")).then(r => r.json()),
  });

  const getTemplateIdForCategory = useCallback((catName: string): number | null => {
    const tpl = backendTemplates.find((t: any) => t.name === catName);
    return tpl ? tpl.id : null;
  }, [backendTemplates]);

  const customerNames = customers.map((c: any) => c.name || c.shortName || "").filter(Boolean);
  const employeeNames = employees.map((e: any) => e.name || `${e.firstName || ""} ${e.lastName || ""}`.trim()).filter(Boolean);
  const itemNames = items.map((i: any) => i.itemName).filter(Boolean);

  const csvFileRef = useRef<HTMLInputElement>(null);

  const getSourceValues = (src?: string) => {
    switch (src) {
      case "customers": return customerNames;
      case "teachers": return employeeNames;
      case "camp_status": return CAMP_STATUS_OPTIONS;
      case "items": return itemNames;
      case "status": return STATUS_OPTIONS;
      default: return [];
    }
  };

  const currentConfig = configs[activeCategory] || {
    name: activeCategory,
    sheets: [{ id: genId(), name: "Sheet1", rows: [] }],
    columns: [...DEFAULT_COLUMNS],
    fieldMapping: { ...DEFAULT_MAPPING },
  };
  const currentSheets = currentConfig.sheets;
  const currentSheet = currentSheets[activeSheetIdx] || currentSheets[0];
  const currentColumns = currentConfig.columns;

  const persistAll = useCallback((cats: string[], cfgs: Record<string, CategoryConfig>) => {
    saveAll(cats, cfgs);
  }, []);

  const flushLiveData = useCallback((): Record<string, CategoryConfig> => {
    if (!jssRef.current) return configs;
    const data = jssRef.current.getData();
    const cfg = configs[activeCategory] ? { ...configs[activeCategory] } : { ...currentConfig };
    const sheets = [...cfg.sheets];
    const idx = Math.min(activeSheetIdx, sheets.length - 1);
    sheets[idx] = { ...sheets[idx], rows: data };
    cfg.sheets = sheets;
    return { ...configs, [activeCategory]: cfg };
  }, [configs, activeCategory, activeSheetIdx, currentConfig]);

  const saveCurrentSheet = useCallback(() => {
    const flushed = flushLiveData();
    setConfigs(flushed);
    persistAll(categories, flushed);
  }, [flushLiveData, categories, persistAll]);

  const buildJssColumns = (cols: ColumnDef[]) => {
    return cols.map(col => {
      const base: any = { title: col.title, width: col.width || 120 };
      switch (col.type) {
        case "dropdown":
          base.type = "dropdown";
          base.source = getSourceValues(col.source);
          base.autocomplete = true;
          break;
        case "calendar":
          base.type = "calendar";
          base.options = { format: "YYYY-MM-DD" };
          break;
        case "numeric":
          base.type = "numeric";
          base.mask = "#,##0";
          break;
        default:
          base.type = "text";
      }
      return base;
    });
  };

  const destroySpreadsheet = useCallback(() => {
    if (jssRef.current) {
      try { jssRef.current.destroy(); } catch {}
      jssRef.current = null;
    }
    if (spreadsheetRef.current) {
      const el = spreadsheetRef.current as any;
      if (el.jspreadsheet) { try { el.jspreadsheet.destroy(); } catch {} }
      if (el.jexcel) { try { el.jexcel.destroy(); } catch {} }
    }
  }, []);

  const initSpreadsheet = useCallback(() => {
    if (!spreadsheetRef.current) return;
    destroySpreadsheet();
    spreadsheetRef.current.innerHTML = "";

    const colDefs = currentColumns;
    const emptyRow = colDefs.map((c) => c.type === "dropdown" && (c.source === "status" || c.source === "camp_status") ? "待確認" : "");
    const sheetData = currentSheet?.rows || [];
    const minRows = Math.max(sheetData.length, 20);
    const paddedData = [...sheetData];
    while (paddedData.length < minRows) {
      paddedData.push([...emptyRow]);
    }
    for (let i = 0; i < paddedData.length; i++) {
      while (paddedData[i].length < colDefs.length) {
        paddedData[i].push("");
      }
    }

    const jssColumns = buildJssColumns(colDefs);
    const tableH = isFullscreen ? `${window.innerHeight - 200}px` : "520px";

    const instance = jspreadsheet(spreadsheetRef.current, {
      worksheets: [{
        data: paddedData,
        columns: jssColumns,
        minDimensions: [colDefs.length, minRows] as any,
        allowInsertRow: true,
        allowDeleteRow: true,
        allowInsertColumn: false,
        allowDeleteColumn: false,
        columnSorting: true,
        search: false,
        defaultColWidth: 120,
      }],
      tableOverflow: true,
      tableWidth: "100%" as any,
      tableHeight: tableH as any,
      onchange: () => { updateFooter(); },
      onafterchanges: () => { updateFooter(); },
      onselection: (_: any, __: any, ___: any, ____: any, _____: any, startRow: number) => {
        setSelectedRow(startRow);
      },
    } as any);

    jssRef.current = instance?.[0] || (spreadsheetRef.current as any).jspreadsheet?.[0] || (spreadsheetRef.current as any).jexcel;

    setTimeout(() => {
      updateFooter();
      if (jssRef.current) {
        const statusColIdx = colDefs.findIndex(c => c.source === "camp_status");
        if (statusColIdx >= 0) {
          const ss = jssRef.current.setStyle?.bind(jssRef.current);
          if (ss) {
            const d = jssRef.current.getData();
            for (let ri = 0; ri < d.length; ri++) {
              const st = String(d[ri]?.[statusColIdx] || "").trim();
              if (!st) continue;
              const bg = st === "開班成功" ? "#dcfce7" : st === "未開班" ? "#fee2e2" : st === "待確認" ? "#fef3c7" : "";
              if (bg) {
                for (let c = 0; c < colDefs.length; c++) {
                  ss(`${String.fromCharCode(65 + (c % 26))}${ri + 1}`, "background-color", bg);
                }
              }
            }
          }
        }
      }
    }, 150);
  }, [activeCategory, activeSheetIdx, currentColumns, currentSheet, isFullscreen, customerNames, employeeNames, itemNames, destroySpreadsheet]);

  const updateFooter = () => {
    if (!jssRef.current) return;
    const data = jssRef.current.getData();
    const cfg = configs[activeCategory];
    const amtCol = cfg?.fieldMapping?.amountCol ?? 5;
    const cols = cfg?.columns || currentColumns;
    const statusColIdx = cols.findIndex(c => c.source === "camp_status");
    let total = 0;
    let rowCount = 0;
    let openCount = 0;
    let closedCount = 0;
    let pendingCount = 0;
    let totalStudents = 0;
    const studentColIdx = cols.findIndex(c => c.title === "班級人數");
    const revenueColIdx = cols.findIndex(c => c.title === "收費");
    const costColIdx = cols.findIndex(c => c.title === "成本");
    let totalRevenue = 0;
    let totalCost = 0;

    data.forEach((row: any[]) => {
      const hasData = row.some((c: any) => String(c || "").trim());
      if (!hasData) return;
      const amt = parseFloat(String(row[amtCol] || "0").replace(/,/g, ""));
      if (!isNaN(amt) && amt !== 0) { total += amt; }
      rowCount++;

      if (statusColIdx >= 0) {
        const st = String(row[statusColIdx] || "").trim();
        if (st === "開班成功") openCount++;
        else if (st === "未開班") closedCount++;
        else if (st) pendingCount++;
      }
      if (studentColIdx >= 0) {
        const s = parseInt(String(row[studentColIdx] || "0").replace(/,/g, ""));
        if (!isNaN(s)) totalStudents += s;
      }
      if (revenueColIdx >= 0) {
        const r = parseFloat(String(row[revenueColIdx] || "0").replace(/,/g, ""));
        if (!isNaN(r)) totalRevenue += r;
      }
      if (costColIdx >= 0) {
        const c = parseFloat(String(row[costColIdx] || "0").replace(/,/g, ""));
        if (!isNaN(c)) totalCost += c;
      }
    });
    const el = document.getElementById("footer-total");
    if (el) {
      if (statusColIdx >= 0) {
        const profit = totalRevenue - totalCost;
        el.textContent = `${rowCount} 班 ｜ 開班 ${openCount} ｜ 未開班 ${closedCount} ｜ 待確認 ${pendingCount} ｜ 學生 ${totalStudents} 人 ｜ 收費 $${totalRevenue.toLocaleString()} ｜ 成本 $${totalCost.toLocaleString()} ｜ 利潤 $${profit.toLocaleString()}`;
      } else {
        el.textContent = `${rowCount} 筆 ｜ 合計金額：$${total.toLocaleString()}`;
      }
    }
  };

  useEffect(() => {
    initSpreadsheet();
    return () => { destroySpreadsheet(); };
  }, [activeCategory, activeSheetIdx, customerNames.length, employeeNames.length, itemNames.length, isFullscreen, currentColumns]);

  useEffect(() => {
    const handleBeforeUnload = () => { saveCurrentSheet(); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveCurrentSheet]);

  useEffect(() => {
    return () => { setSidebarCollapsed(false); };
  }, [setSidebarCollapsed]);

  const handleSaveSheet = () => {
    saveCurrentSheet();
    toast({ title: "已儲存", description: `分類「${activeCategory}」的資料已儲存` });
  };

  const handleSwitchCategory = (cat: string) => {
    saveCurrentSheet();
    setActiveCategory(cat);
    setActiveSheetIdx(0);
  };

  const handleSwitchSheet = (idx: number) => {
    saveCurrentSheet();
    setActiveSheetIdx(idx);
  };

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categories.includes(name)) {
      toast({ title: "分類已存在", variant: "destructive" });
      return;
    }
    const flushed = flushLiveData();
    const updated = [...categories, name];
    const catDefaults = CATEGORY_DEFAULTS[name];
    const newCfg: CategoryConfig = {
      name,
      sheets: [{ id: genId(), name: "Sheet1", rows: [] }],
      columns: catDefaults ? catDefaults.columns.map(c => ({ ...c })) : [...DEFAULT_COLUMNS],
      fieldMapping: catDefaults ? { ...catDefaults.mapping } : { ...DEFAULT_MAPPING },
    };
    const newConfigs = { ...flushed, [name]: newCfg };
    setCategories(updated);
    setConfigs(newConfigs);
    persistAll(updated, newConfigs);
    setActiveCategory(name);
    setActiveSheetIdx(0);
    setNewCategoryName("");
    setShowAddCategory(false);
    toast({ title: `已新增分類「${name}」` });
  };

  const handleDeleteCategory = (cat: string) => {
    if (categories.length <= 1) {
      toast({ title: "至少需保留一個分類", variant: "destructive" });
      return;
    }
    if (!confirm(`確定刪除分類「${cat}」及其所有資料？`)) return;
    const flushed = flushLiveData();
    const updated = categories.filter(c => c !== cat);
    const newConfigs = { ...flushed };
    delete newConfigs[cat];
    setCategories(updated);
    setConfigs(newConfigs);
    persistAll(updated, newConfigs);
    if (activeCategory === cat) { setActiveCategory(updated[0]); setActiveSheetIdx(0); }
    toast({ title: `已刪除分類「${cat}」` });
  };

  const handleAddSheet = () => {
    const name = newSheetName.trim() || `Sheet${currentSheets.length + 1}`;
    const flushed = flushLiveData();
    const newSheet: SheetInfo = { id: genId(), name, rows: [] };
    const flushedCfg = flushed[activeCategory] || currentConfig;
    const cfg = { ...flushedCfg, sheets: [...flushedCfg.sheets, newSheet] };
    const newConfigs = { ...flushed, [activeCategory]: cfg };
    setConfigs(newConfigs);
    persistAll(categories, newConfigs);
    setActiveSheetIdx(flushedCfg.sheets.length);
    setNewSheetName("");
    setShowAddSheet(false);
    toast({ title: `已新增列表「${name}」` });
  };

  const handleDeleteSheet = (idx: number) => {
    if (currentSheets.length <= 1) {
      toast({ title: "至少需保留一個列表", variant: "destructive" });
      return;
    }
    const sheetName = currentSheets[idx].name;
    if (!confirm(`確定刪除列表「${sheetName}」？`)) return;
    const flushed = flushLiveData();
    const flushedCfg = flushed[activeCategory] || currentConfig;
    const newSheets = flushedCfg.sheets.filter((_: any, i: number) => i !== idx);
    const cfg = { ...flushedCfg, sheets: newSheets };
    const newConfigs = { ...flushed, [activeCategory]: cfg };
    setConfigs(newConfigs);
    persistAll(categories, newConfigs);
    if (activeSheetIdx >= newSheets.length) setActiveSheetIdx(newSheets.length - 1);
    toast({ title: `已刪除列表「${sheetName}」` });
  };

  const handleDuplicateSheet = (idx: number) => {
    const flushed = flushLiveData();
    const flushedCfg = flushed[activeCategory] || currentConfig;
    const src = flushedCfg.sheets[idx];
    const newSheet: SheetInfo = {
      id: genId(),
      name: `${src.name} (複製)`,
      rows: (src.rows || []).map((r: any[]) => [...r]),
    };
    const newSheets = [...flushedCfg.sheets];
    newSheets.splice(idx + 1, 0, newSheet);
    const cfg = { ...flushedCfg, sheets: newSheets };
    const newConfigs = { ...flushed, [activeCategory]: cfg };
    setConfigs(newConfigs);
    persistAll(categories, newConfigs);
    setActiveSheetIdx(idx + 1);
    toast({ title: `已複製列表「${src.name}」` });
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const parsed = parseCSVContent(text);
      if (parsed.length < 2) {
        toast({ title: "CSV 檔案無有效資料", variant: "destructive" });
        return;
      }

      const headerRow = parsed[0];
      const dataRows = parsed.slice(1);

      const isCampFormat = headerRow.some(h => h.includes("營隊課程") || h.includes("主講薪資") || h.includes("場地費"));

      if (isCampFormat && activeCategory === "營隊") {
        const campColMap: Record<string, number> = {};
        CAMP_COLUMNS.forEach((col, idx) => { campColMap[col.title] = idx; });

        const csvToTargetMap: number[] = [];
        const csvHeaderMap: Record<string, string> = {
          "地點": "地點",
          "營隊課程": "營隊課程",
          "開課日期": "開課日期",
          "截止日期": "截止日期",
          "費用": "費用",
          "班級人數": "班級人數",
          "主講數量": "主講數量",
          "助教數量": "助教數量",
          "主講薪資(元/天)": "主講薪資(元/天)",
          "主講薪資（元/天）": "主講薪資(元/天)",
          "助教薪資(元/天)": "助教薪資(元/天)",
          "助教薪資（元/天）": "助教薪資(元/天)",
          "場地費(元/天)": "場地費(元/天)",
          "場地費（元/天）": "場地費(元/天)",
          "備註": "備註",
          "派案主講": "派案主講",
          "助教1": "助教1",
          "助教2": "助教2",
          "助教3": "助教3",
          "成本": "成本",
          "收費": "收費",
          "利潤": "利潤",
        };

        let locationColsSeen = 0;
        for (let ci = 0; ci < headerRow.length; ci++) {
          const h = headerRow[ci].trim().replace(/（/g, "(").replace(/）/g, ")");
          if (h === "地點") {
            locationColsSeen++;
            if (locationColsSeen === 1) {
              csvToTargetMap[ci] = campColMap["地點"];
            } else {
              csvToTargetMap[ci] = campColMap["地址"];
            }
          } else {
            const targetTitle = csvHeaderMap[h];
            csvToTargetMap[ci] = targetTitle !== undefined ? (campColMap[targetTitle] ?? -1) : -1;
          }
        }

        let lastLocation = "";
        let lastAddress = "";
        const mappedRows: string[][] = [];
        const numericCols = new Set([5, 6, 7, 8, 9, 10, 11, 17, 18, 19]);

        for (const csvRow of dataRows) {
          const hasData = csvRow.some((cell, ci) => {
            if (ci === 0) return false;
            return cell.trim() !== "";
          });
          if (!hasData && !csvRow[0]?.trim()) continue;

          const targetRow = new Array(CAMP_COLUMNS.length).fill("");

          for (let ci = 0; ci < csvRow.length; ci++) {
            const ti = csvToTargetMap[ci];
            if (ti >= 0 && ti < CAMP_COLUMNS.length) {
              let val = csvRow[ci]?.trim() || "";
              if (numericCols.has(ti)) val = cleanNTDollar(val);
              targetRow[ti] = val;
            }
          }

          if (targetRow[0]) lastLocation = targetRow[0];
          else targetRow[0] = lastLocation;

          if (targetRow[2]) lastAddress = targetRow[2];
          else targetRow[2] = lastAddress;

          const hasCourse = targetRow[1]?.trim();
          if (!hasCourse) continue;

          const notes = targetRow[12] || "";
          if (notes === "開班開到不行") {
            targetRow[20] = "開班成功";
          } else if (notes === "你會窮死") {
            const students = parseInt(targetRow[6]) || 0;
            targetRow[20] = students > 0 ? "待確認" : "未開班";
          } else {
            const students = parseInt(targetRow[6]) || 0;
            targetRow[20] = students > 0 ? "待確認" : "未開班";
          }

          mappedRows.push(targetRow);
        }

        if (mappedRows.length === 0) {
          toast({ title: "無有效資料列", variant: "destructive" });
          return;
        }

        const flushed = flushLiveData();
        const sheetName = file.name.replace(/\.[^.]+$/, "").substring(0, 30) || "匯入資料";
        const newSheet: SheetInfo = { id: genId(), name: sheetName, rows: mappedRows };
        const flushedCfg = flushed[activeCategory] || currentConfig;

        if (!flushed[activeCategory]?.columns || flushed[activeCategory]?.columns?.length === DEFAULT_COLUMNS.length) {
          flushedCfg.columns = CAMP_COLUMNS.map(c => ({ ...c }));
          flushedCfg.fieldMapping = { ...CAMP_MAPPING };
        }

        const cfg = { ...flushedCfg, sheets: [...flushedCfg.sheets, newSheet] };
        const newConfigs = { ...flushed, [activeCategory]: cfg };
        setConfigs(newConfigs);
        persistAll(categories, newConfigs);
        setActiveSheetIdx(cfg.sheets.length - 1);
        toast({ title: "匯入成功", description: `已匯入 ${mappedRows.length} 筆營隊資料到「${sheetName}」` });
      } else {
        const dataColCount = Math.max(...parsed.map(r => r.length));
        const targetColCount = currentColumns.length;
        const rows = dataRows.map(r => {
          const row = new Array(targetColCount).fill("");
          for (let i = 0; i < Math.min(r.length, targetColCount); i++) {
            row[i] = r[i] || "";
          }
          return row;
        }).filter(r => r.some((c: string) => c.trim()));

        if (rows.length === 0) {
          toast({ title: "CSV 檔案無有效資料", variant: "destructive" });
          return;
        }

        const flushed = flushLiveData();
        const sheetName = file.name.replace(/\.[^.]+$/, "").substring(0, 30) || "匯入資料";
        const newSheet: SheetInfo = { id: genId(), name: sheetName, rows };
        const flushedCfg = flushed[activeCategory] || currentConfig;
        const cfg = { ...flushedCfg, sheets: [...flushedCfg.sheets, newSheet] };
        const newConfigs = { ...flushed, [activeCategory]: cfg };
        setConfigs(newConfigs);
        persistAll(categories, newConfigs);
        setActiveSheetIdx(cfg.sheets.length - 1);
        toast({ title: "匯入成功", description: `已匯入 ${rows.length} 筆資料到「${sheetName}」` });
      }
    };
    reader.readAsText(file);
    if (csvFileRef.current) csvFileRef.current.value = "";
  };

  const handleMarkCampStatus = (status: string) => {
    if (!jssRef.current) return;
    const data = jssRef.current.getData();
    const statusColIdx = currentColumns.findIndex(c => c.title === "開課狀態");
    if (statusColIdx < 0) {
      toast({ title: "找不到「開課狀態」欄位", variant: "destructive" });
      return;
    }

    const selectedRows: number[] = [];
    try {
      const sel = jssRef.current.getSelectedRows?.(true);
      if (sel && sel.length > 0) {
        for (let i = 0; i < sel.length; i++) selectedRows.push(sel[i]);
      }
    } catch {}

    if (selectedRows.length === 0) {
      selectedRows.push(selectedRow);
    }

    let count = 0;
    const ss = jssRef.current.setStyle?.bind(jssRef.current);
    const colCount = currentColumns.length;

    for (const ri of selectedRows) {
      if (ri < 0 || ri >= data.length) continue;
      const row = data[ri];
      if (!row || !Array.isArray(row)) continue;
      const hasContent = row.some((c: any, ci: number) => ci !== statusColIdx && String(c || "").trim());
      if (!hasContent) continue;

      jssRef.current.setValueFromCoords(statusColIdx, ri, status, false);
      count++;

      if (ss) {
        const bgColor = status === "開班成功" ? "#dcfce7" : status === "未開班" ? "#fee2e2" : "#fef3c7";
        for (let c = 0; c < colCount; c++) {
          ss(`${String.fromCharCode(65 + (c % 26))}${ri + 1}`, "background-color", bgColor);
        }
      }
    }

    if (count === 0) {
      toast({ title: "無可標記的資料列", description: "請先選取有資料的列", variant: "destructive" });
      return;
    }

    toast({ title: `已標記 ${count} 列為「${status}」` });
    saveCurrentSheet();
  };

  const openColumnConfig = () => {
    setEditingColumns(currentColumns.map(c => ({ ...c })));
    setShowColumnConfig(true);
  };

  const openMappingConfig = () => {
    setEditingMapping({ ...currentConfig.fieldMapping });
    setShowMappingConfig(true);
  };

  const handleSaveColumns = () => {
    const cfg = { ...currentConfig, columns: editingColumns };
    const newConfigs = { ...configs, [activeCategory]: cfg };
    setConfigs(newConfigs);
    persistAll(categories, newConfigs);
    setShowColumnConfig(false);
    toast({ title: "欄位設定已儲存" });
  };

  const handleSaveMapping = () => {
    const cfg = { ...currentConfig, fieldMapping: editingMapping };
    const newConfigs = { ...configs, [activeCategory]: cfg };
    setConfigs(newConfigs);
    persistAll(categories, newConfigs);
    setShowMappingConfig(false);
    toast({ title: "欄位對應已儲存" });
  };

  const addColumn = () => {
    setEditingColumns([...editingColumns, { title: `欄位${editingColumns.length + 1}`, type: "text", width: 120 }]);
  };

  const removeColumn = (idx: number) => {
    if (editingColumns.length <= 1) return;
    setEditingColumns(editingColumns.filter((_, i) => i !== idx));
  };

  const updateColumn = (idx: number, field: string, val: any) => {
    const cols = [...editingColumns];
    (cols[idx] as any)[field] = val;
    setEditingColumns(cols);
  };

  const toggleFullscreen = () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    setSidebarCollapsed(next);
  };

  const handleConvertRow = async (rowIndex: number): Promise<boolean> => {
    if (!jssRef.current) return false;
    const data = jssRef.current.getData();
    if (!data || !data[rowIndex]) return false;
    const row = data[rowIndex];
    const fm = currentConfig.fieldMapping;
    const maxCol = row.length - 1;
    const safeCol = (c: number) => Math.min(Math.max(c, 0), maxCol);

    const schoolName = row[safeCol(fm.schoolNameCol)] || "";
    const date = row[safeCol(fm.dateCol)] || "";
    const time = row[safeCol(fm.timeCol)] || "";
    const instructor = row[safeCol(fm.instructorCol)] || "";
    const courseItem = row[safeCol(fm.courseItemCol)] || "";
    const amount = row[safeCol(fm.amountCol)] || "";
    const status = row[safeCol(fm.statusCol)] || "";
    const notes = row[safeCol(fm.notesCol)] || "";

    let orderSchoolName = schoolName;
    let orderCourseItem = courseItem;
    if (fm.mergeRule === "school_course") {
      orderCourseItem = `${schoolName} - ${courseItem}`;
    } else if (fm.mergeRule === "course_school") {
      orderCourseItem = `${courseItem} - ${schoolName}`;
    }

    const ss = jssRef.current.setStyle?.bind(jssRef.current);
    const colCount = currentColumns.length;

    if (!schoolName || !date || !courseItem || !amount) {
      toast({ title: "欄位不完整", description: "學校名稱、日期、課程項目、金額為必填", variant: "destructive" });
      return false;
    }
    if (!quickProjectRef.current) {
      toast({ title: "請先選擇歸屬專案", description: "每一筆收入都必須歸屬到專案，請在頁面上方選擇", variant: "destructive" });
      return false;
    }

    const parsedAmount = parseFloat(String(amount).replace(/,/g, ""));
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({ title: "金額無效", description: "金額必須為正數", variant: "destructive" });
      return false;
    }

    try {
      const res = await fetch(api("create-sales-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolName: orderSchoolName,
          date, time, instructor,
          courseItem: orderCourseItem,
          amount: parsedAmount,
          status: status || "待確認",
          notes,
          category: activeCategory,
          orderSource: "quick_entry",
          projectId: Number(quickProjectRef.current),
          templateId: getTemplateIdForCategory(activeCategory),
          ...(fm.labelCol != null && row[safeCol(fm.labelCol)] ? { label: row[safeCol(fm.labelCol)] } : {}),
          ...(fm.classWeeksCol != null && row[safeCol(fm.classWeeksCol)] ? { classWeeks: Number(row[safeCol(fm.classWeeksCol)]) } : {}),
          ...(fm.courseStartDateCol != null && row[safeCol(fm.courseStartDateCol)] ? { courseStartDate: row[safeCol(fm.courseStartDateCol)] } : {}),
          ...(fm.courseEndDateCol != null && row[safeCol(fm.courseEndDateCol)] ? { courseEndDate: row[safeCol(fm.courseEndDateCol)] } : {}),
          ...(fm.teacherFeeCol != null && row[safeCol(fm.teacherFeeCol)] ? { teacherFeePerSession: Number(row[safeCol(fm.teacherFeeCol)]) } : {}),
          ...(fm.materialFeeMethodCol != null && row[safeCol(fm.materialFeeMethodCol)] ? { teacherMaterialFeeMethod: row[safeCol(fm.materialFeeMethodCol)] } : {}),
          ...(fm.coursePeriodCol != null && row[safeCol(fm.coursePeriodCol)] ? { coursePeriod: row[safeCol(fm.coursePeriodCol)] } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "建立失敗");
      }

      const result = await res.json();
      if (jssRef.current.setValueFromCoords) {
        jssRef.current.setValueFromCoords(fm.statusCol, rowIndex, "已成交", false);
      }
      if (ss) {
        for (let c = 0; c < colCount; c++) {
          const col = String.fromCharCode(65 + c);
          ss(`${col}${rowIndex + 1}`, "background-color", "#dcfce7");
        }
      }
      saveCurrentSheet();
      toast({ title: "訂單已建立", description: `訂單編號：${result.orderNumber}` });
      return true;
    } catch (err: any) {
      if (ss) {
        for (let c = 0; c < colCount; c++) {
          const col = String.fromCharCode(65 + c);
          ss(`${col}${rowIndex + 1}`, "background-color", "#fee2e2");
        }
      }
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
      return false;
    }
  };

  const handleConvertAll = async () => {
    if (!jssRef.current) return;
    const data = jssRef.current.getData();
    const fm = currentConfig.fieldMapping;
    const maxC = (data[0]?.length || 1) - 1;
    const sc = (c: number) => Math.min(Math.max(c, 0), maxC);
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row[sc(fm.schoolNameCol)] || !row[sc(fm.dateCol)] || !row[sc(fm.courseItemCol)] || !row[sc(fm.amountCol)]) continue;
      if (row[sc(fm.statusCol)] === "已成交") continue;
      const ok = await handleConvertRow(i);
      if (ok) successCount++;
      else failCount++;
    }
    toast({ title: "批次轉單完成", description: `成功 ${successCount} 筆，失敗 ${failCount} 筆` });
  };

  const handleSearch = () => {
    if (!jssRef.current || !searchTerm.trim()) return;
    const data = jssRef.current.getData();
    if (!data) return;
    const ss = jssRef.current.setStyle?.bind(jssRef.current);
    const colCount = currentColumns.length;
    let foundRow = -1;
    for (let i = 0; i < data.length; i++) {
      const match = data[i].some((cell: any) =>
        String(cell || "").toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (match) {
        foundRow = i;
        if (ss) for (let c = 0; c < colCount; c++) { ss(`${String.fromCharCode(65 + c)}${i + 1}`, "background-color", "#fef3c7"); }
      } else {
        if (ss) for (let c = 0; c < colCount; c++) { ss(`${String.fromCharCode(65 + c)}${i + 1}`, "background-color", ""); }
      }
    }
    if (foundRow === -1) toast({ title: "無搜尋結果", description: `本頁找不到「${searchTerm}」` });
  };

  const handleGlobalSearch = () => {
    if (!searchTerm.trim()) return;
    const results: { category: string; sheet: string; count: number }[] = [];

    for (const [cat, cfg] of Object.entries(configs)) {
      for (const sheet of cfg.sheets) {
        let count = 0;
        (sheet.rows || []).forEach((row) => {
          if (row.some((cell: any) => String(cell || "").toLowerCase().includes(searchTerm.toLowerCase()))) count++;
        });
        if (count > 0) results.push({ category: cat, sheet: sheet.name, count });
      }
    }

    if (jssRef.current) {
      const currentData = jssRef.current.getData();
      let count = 0;
      currentData.forEach((row: any[]) => {
        if (row.some((cell: any) => String(cell || "").toLowerCase().includes(searchTerm.toLowerCase()))) count++;
      });
      const existing = results.find(r => r.category === activeCategory && r.sheet === currentSheet?.name);
      if (count > 0 && !existing) {
        results.push({ category: activeCategory, sheet: currentSheet?.name || "", count });
      }
    }

    const totalCount = results.reduce((sum, r) => sum + r.count, 0);
    if (totalCount === 0) {
      toast({ title: "無搜尋結果", description: `所有分類均找不到「${searchTerm}」` });
    } else {
      const desc = results.map(r => `${r.category}/${r.sheet}: ${r.count} 筆`).join("、");
      toast({ title: `找到 ${totalCount} 筆結果`, description: desc });
      handleSearch();
    }
  };

  const getStatsData = () => {
    const allData: { category: string; rows: any[][]; amtCol: number }[] = [];

    for (const [cat, cfg] of Object.entries(configs)) {
      const amtCol = cfg.fieldMapping.amountCol;
      const statusCol = cfg.fieldMapping.statusCol;
      for (const sheet of cfg.sheets) {
        if (cat === activeCategory && sheet.id === currentSheet?.id && jssRef.current) {
          allData.push({ category: cat, rows: jssRef.current.getData(), amtCol });
        } else {
          allData.push({ category: cat, rows: sheet.rows || [], amtCol });
        }
      }
    }

    let totalAmount = 0;
    let totalRows = 0;
    const byCategory: Record<string, { amount: number; count: number; confirmed: number; pending: number; cancelled: number }> = {};
    const byStatus: Record<string, number> = { "待確認": 0, "已成交": 0, "已取消": 0 };

    for (const entry of allData) {
      if (!byCategory[entry.category]) {
        byCategory[entry.category] = { amount: 0, count: 0, confirmed: 0, pending: 0, cancelled: 0 };
      }
      const cfg = configs[entry.category];
      const statusCol = cfg?.fieldMapping?.statusCol ?? 6;
      for (const row of entry.rows) {
        const amt = parseFloat(String(row[entry.amtCol] || "0").replace(/,/g, ""));
        const st = row[statusCol] || "";
        if (!row[0] && !row[entry.amtCol] && !amt) continue;
        totalAmount += isNaN(amt) ? 0 : amt;
        totalRows++;
        byCategory[entry.category].amount += isNaN(amt) ? 0 : amt;
        byCategory[entry.category].count++;
        if (st === "已成交") { byCategory[entry.category].confirmed++; byStatus["已成交"]++; }
        else if (st === "已取消") { byCategory[entry.category].cancelled++; byStatus["已取消"]++; }
        else { byCategory[entry.category].pending++; byStatus["待確認"]++; }
      }
    }
    return { totalAmount, totalRows, byCategory, byStatus };
  };

  const stats = getStatsData();

  return (
    <div className={`space-y-3 ${isFullscreen ? "fixed inset-0 z-50 bg-background p-4 overflow-y-auto" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">快速錄單</h1>
          <p className="text-xs text-muted-foreground mt-1">多分類、多列表、自訂欄位、批次轉單</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="whitespace-nowrap text-muted-foreground">歸屬專案 <span className="text-red-500">*</span></span>
            <select
              className={`h-9 rounded-md border bg-background px-2 text-sm ${quickProjectId ? "border-input" : "border-red-400"}`}
              value={quickProjectId}
              onChange={(e) => {
                setQuickProjectId(e.target.value);
                try { localStorage.setItem("erp-quick-entry-project", e.target.value); } catch { /* 無法記住也不影響使用 */ }
              }}
              data-testid="select-quick-entry-project"
            >
              <option value="">請選擇專案</option>
              {(Array.isArray(projectList) ? projectList : []).filter((p: any) => p.isActive !== false || String(p.id) === quickProjectId).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="mr-1 h-4 w-4" /> : <Maximize2 className="mr-1 h-4 w-4" />}
            {isFullscreen ? "退出全螢幕" : "全螢幕"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowStats(!showStats)}>
            <BarChart3 className="mr-1 h-4 w-4" />{showStats ? "隱藏統計" : "統計"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => csvFileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" />匯入CSV
          </Button>
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleCSVImport}
          />
          <Button variant="outline" size="sm" onClick={openColumnConfig}>
            <Settings2 className="mr-1 h-4 w-4" />欄位設定
          </Button>
          <Button variant="outline" size="sm" onClick={openMappingConfig}>
            <ArrowRightLeft className="mr-1 h-4 w-4" />轉單對應
          </Button>
          <Button variant="outline" size="sm" onClick={handleSaveSheet}>
            <Save className="mr-1 h-4 w-4" />儲存
          </Button>
          {activeCategory === "營隊" && (
            <>
              <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleMarkCampStatus("開班成功")}>
                <CheckCircle2 className="mr-1 h-4 w-4" />開班成功
              </Button>
              <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={() => handleMarkCampStatus("未開班")}>
                未開班
              </Button>
            </>
          )}
          <Button size="sm" onClick={handleConvertAll}>
            <FileSpreadsheet className="mr-1 h-4 w-4" />批次轉單
          </Button>
        </div>
      </div>

      {showStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground">全量總金額</div>
            <div className="text-xl font-bold text-primary">${stats.totalAmount.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">共 {stats.totalRows} 筆</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground">待確認</div>
            <div className="text-xl font-bold text-yellow-600">{stats.byStatus["待確認"]}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground">已成交</div>
            <div className="text-xl font-bold text-green-600">{stats.byStatus["已成交"]}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground">已取消</div>
            <div className="text-xl font-bold text-red-600">{stats.byStatus["已取消"]}</div>
          </CardContent></Card>
          {Object.entries(stats.byCategory).map(([cat, data]) => (
            <Card key={cat}><CardContent className="pt-3 pb-3">
              <div className="text-xs font-medium">{cat}</div>
              <div className="text-lg font-bold">${data.amount.toLocaleString()}</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{data.count} 筆</Badge>
                {data.confirmed > 0 && <Badge className="bg-green-100 text-green-800 text-[10px]">{data.confirmed} 成交</Badge>}
                {data.pending > 0 && <Badge className="bg-yellow-100 text-yellow-800 text-[10px]">{data.pending} 待確認</Badge>}
                {data.cancelled > 0 && <Badge className="bg-red-100 text-red-800 text-[10px]">{data.cancelled} 取消</Badge>}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={activeCategory} onValueChange={handleSwitchCategory}>
                <TabsList className="h-8">
                  {categories.map(cat => (
                    <TabsTrigger key={cat} value={cat} className="text-xs px-3 py-1 relative group">
                      {cat}
                      {categories.length > 1 && (
                        <span
                          className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center bg-destructive text-white rounded-full text-[10px] cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat); }}
                        >×</span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowAddCategory(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜尋..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleGlobalSearch(); }}
                  className="pl-7 h-8 w-[180px] text-sm"
                />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleGlobalSearch}>跨分類搜尋</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSearch}>本頁搜尋</Button>
            </div>
          </div>

          <div className="flex items-center gap-1 mb-2 border-b pb-2">
            {currentSheets.map((sheet, idx) => (
              <div
                key={sheet.id}
                className={`flex items-center gap-1 px-3 py-1 rounded-t text-xs cursor-pointer border border-b-0 group ${idx === activeSheetIdx ? "bg-background font-medium border-border" : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"}`}
                onClick={() => handleSwitchSheet(idx)}
              >
                {sheet.name}
                <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
                  <button
                    className="hover:text-primary"
                    onClick={(e) => { e.stopPropagation(); handleDuplicateSheet(idx); }}
                    title="複製列表"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {currentSheets.length > 1 && (
                    <button
                      className="hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDeleteSheet(idx); }}
                      title="刪除列表"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddSheet(true)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="border rounded-lg" style={{ position: "relative", overflow: "auto" }}>
            <div ref={spreadsheetRef} />
          </div>

          <div className="flex items-center justify-between mt-2">
            <div id="footer-total" className="text-sm font-medium text-muted-foreground">0 筆 ｜ 合計金額：$0</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleConvertRow(selectedRow)}>
                轉成訂單（第 {selectedRow + 1} 列）
              </Button>
            </div>
          </div>

          <div className="mt-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              逐列轉單：選取一列後點擊「轉成訂單」｜ 批次轉單：頂部「批次轉單」轉換所有待確認列 ｜
              貼上資料：Ctrl+V 貼入 ｜ 右鍵選單可插入/刪除行列
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader><DialogTitle>新增分類</DialogTitle></DialogHeader>
          <Input
            placeholder="輸入分類名稱（例如：營隊、研習）"
            value={newCategoryName}
            onChange={e => setNewCategoryName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAddCategory(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCategory(false)}>取消</Button>
            <Button onClick={handleAddCategory} disabled={!newCategoryName.trim()}>新增</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddSheet} onOpenChange={setShowAddSheet}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader><DialogTitle>新增列表</DialogTitle></DialogHeader>
          <Input
            placeholder={`輸入列表名稱（預設：Sheet${currentSheets.length + 1}）`}
            value={newSheetName}
            onChange={e => setNewSheetName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAddSheet(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSheet(false)}>取消</Button>
            <Button onClick={handleAddSheet}>新增</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showColumnConfig} onOpenChange={setShowColumnConfig}>
        <DialogContent className="md:max-w-2xl max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>欄位設定 — {activeCategory}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">自訂此分類的表頭名稱、欄位類型與資料來源。每個分類可以有不同的欄位配置。</p>
          <div className="space-y-2 mt-2">
            {editingColumns.map((col, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 border rounded">
                <span className="text-xs text-muted-foreground w-6">{idx + 1}</span>
                <Input
                  value={col.title}
                  onChange={e => updateColumn(idx, "title", e.target.value)}
                  className="h-8 flex-1"
                  placeholder="欄位名稱"
                />
                <Select value={col.type} onValueChange={v => updateColumn(idx, "type", v)}>
                  <SelectTrigger className="h-8 w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">文字</SelectItem>
                    <SelectItem value="dropdown">下拉選單</SelectItem>
                    <SelectItem value="calendar">日期</SelectItem>
                    <SelectItem value="numeric">數字</SelectItem>
                  </SelectContent>
                </Select>
                {col.type === "dropdown" && (
                  <Select value={col.source || ""} onValueChange={v => updateColumn(idx, "source", v)}>
                    <SelectTrigger className="h-8 w-[120px]"><SelectValue placeholder="選擇來源" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customers">客戶(學校)</SelectItem>
                      <SelectItem value="teachers">講師(人員清冊)</SelectItem>
                      <SelectItem value="items">品項(課程項目)</SelectItem>
                      <SelectItem value="status">狀態</SelectItem>
                      <SelectItem value="camp_status">開課狀態</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Input
                  type="number"
                  value={col.width || 120}
                  onChange={e => updateColumn(idx, "width", parseInt(e.target.value) || 120)}
                  className="h-8 w-[70px]"
                  placeholder="寬度"
                />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeColumn(idx)} disabled={editingColumns.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={addColumn}>
              <Plus className="mr-1 h-3.5 w-3.5" />新增欄位
            </Button>
            {CATEGORY_DEFAULTS[activeCategory] && (
              <Button variant="outline" size="sm" onClick={() => {
                const def = CATEGORY_DEFAULTS[activeCategory];
                setEditingColumns(def.columns.map(c => ({ ...c })));
              }}>
                重置為預設欄位
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowColumnConfig(false)}>取消</Button>
            <Button onClick={handleSaveColumns}>儲存設定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMappingConfig} onOpenChange={setShowMappingConfig}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>轉單欄位對應 — {activeCategory}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">設定轉換成銷售訂單時，各欄位的對應關係。欄位編號從 0 開始。</p>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                ["schoolNameCol", "學校名稱欄"],
                ["dateCol", "日期欄"],
                ["timeCol", "時間欄"],
                ["instructorCol", "講師欄"],
                ["courseItemCol", "課程項目欄"],
                ["amountCol", "金額欄"],
                ["statusCol", "狀態欄"],
                ["notesCol", "備註欄"],
              ] as [keyof FieldMapping, string][]).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={0}
                      value={editingMapping[key] as number}
                      onChange={e => setEditingMapping({ ...editingMapping, [key]: parseInt(e.target.value) || 0 })}
                      className="h-8"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {currentColumns[editingMapping[key] as number]?.title || "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">合併規則（轉入訂單時）</Label>
              <Select value={editingMapping.mergeRule} onValueChange={v => setEditingMapping({ ...editingMapping, mergeRule: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不合併</SelectItem>
                  <SelectItem value="school_course">學校名稱 + 課程項目 → 訂單品名</SelectItem>
                  <SelectItem value="course_school">課程項目 + 學校名稱 → 訂單品名</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">例如：將「信義國小」+「魔術表演」合併為訂單品項名稱</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMappingConfig(false)}>取消</Button>
            <Button onClick={handleSaveMapping}>儲存設定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        .jss_container { font-family: inherit !important; }
        .jss thead td { background-color: hsl(var(--muted)) !important; color: hsl(var(--muted-foreground)) !important; font-weight: 600 !important; font-size: 13px !important; }
        .jss tbody td { font-size: 13px !important; border-color: hsl(var(--border)) !important; }
        .jss tbody td:hover { background-color: hsl(var(--accent)) !important; }
        .jss .jss_search { border-color: hsl(var(--border)) !important; border-radius: 6px !important; }
        .jss_toolbar { background-color: hsl(var(--card)) !important; }
        .jss_content { overflow: auto !important; }
        .jss { border-color: hsl(var(--border)) !important; }
        .jss_search, .jss_toolbar .jss_toolbar_item:has(.jss_search) { display: none !important; }
        .jss_tab, .jss_tab_link { display: none !important; }
        div[data-search], .jtabs-headers { display: none !important; }
        .jss_container .jss_content { border-radius: 8px !important; }
      `}</style>
    </div>
  );
}
