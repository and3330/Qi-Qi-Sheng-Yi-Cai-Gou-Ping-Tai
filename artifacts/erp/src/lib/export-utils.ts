import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { saveAs } from "file-saver";

export interface ExportRow {
  [key: string]: string | number;
}

export interface ExportOptions {
  title: string;
  subtitle?: string;
  fileName: string;
  headers: string[];
  rows: ExportRow[];
  columnKeys: string[];
  columnWidths?: number[];
}

export function exportCSV(opts: ExportOptions) {
  const bom = "\uFEFF";
  const headerLine = opts.headers.join(",");
  const dataLines = opts.rows.map(row =>
    opts.columnKeys.map(key => {
      const val = row[key];
      if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val ?? "";
    }).join(",")
  );
  const csv = bom + [headerLine, ...dataLines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveAs(blob, `${opts.fileName}.csv`);
}

export function exportExcel(opts: ExportOptions) {
  const wb = XLSX.utils.book_new();
  const wsData = [
    [opts.title],
    opts.subtitle ? [opts.subtitle] : [],
    [],
    opts.headers,
    ...opts.rows.map(row => opts.columnKeys.map(key => row[key] ?? ""))
  ].filter(r => r.length > 0);

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  const colWidths = opts.columnWidths || opts.headers.map((h, i) => {
    const headerLen = h.length * 2.5;
    const maxDataLen = Math.max(...opts.rows.map(r => String(r[opts.columnKeys[i]] ?? "").length), 0);
    return Math.max(headerLen, maxDataLen * 1.5, 10);
  });
  ws["!cols"] = colWidths.map(w => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, opts.title.slice(0, 31));
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `${opts.fileName}.xlsx`);
}

export async function exportPDF(opts: ExportOptions) {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-9999px;top:0;background:#fff;padding:20px;font-family:sans-serif;width:900px;";

  const title = document.createElement("h2");
  title.textContent = opts.title;
  title.style.cssText = "text-align:center;font-size:18px;margin:0 0 4px;";
  container.appendChild(title);

  if (opts.subtitle) {
    const sub = document.createElement("div");
    sub.textContent = opts.subtitle;
    sub.style.cssText = "text-align:center;font-size:12px;color:#666;margin-bottom:12px;";
    container.appendChild(sub);
  }

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:11px;";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const h of opts.headers) {
    const th = document.createElement("th");
    th.textContent = h;
    th.style.cssText = "padding:6px 8px;border:1px solid #ddd;background:#3b82f6;color:#fff;text-align:left;font-weight:600;white-space:nowrap;";
    if (h === "金額" || h === "餘額" || h === "全部合計" || !["科目代碼", "科目名稱"].includes(h)) {
      th.style.textAlign = "right";
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  opts.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i % 2 === 1) tr.style.background = "#f5f7fa";
    const nameVal = String(row[opts.columnKeys[1]] ?? "");
    const isSectionHeader = nameVal.startsWith("壹") || nameVal.startsWith("貳") || nameVal.startsWith("參") || nameVal === "負債及權益合計";
    if (isSectionHeader) {
      tr.style.cssText = "background:#eef2ff;font-weight:bold;";
    }
    for (let j = 0; j < opts.columnKeys.length; j++) {
      const td = document.createElement("td");
      const val = row[opts.columnKeys[j]];
      td.textContent = val === undefined || val === null ? "" : String(val);
      td.style.cssText = "padding:4px 8px;border:1px solid #eee;white-space:nowrap;";
      if (j >= 2) td.style.textAlign = "right";
      if (j === 0) td.style.cssText += "font-family:monospace;font-size:10px;color:#888;";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, logging: false });
    const imgData = canvas.toDataURL("image/png");
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const isLandscape = opts.headers.length > 5;
    const doc = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth() - 20;
    const pageHeight = doc.internal.pageSize.getHeight() - 20;
    const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
    const finalWidth = imgWidth * ratio;
    const finalHeight = imgHeight * ratio;
    doc.addImage(imgData, "PNG", 10, 10, finalWidth, finalHeight);
    doc.save(`${opts.fileName}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export function buildVerticalIncomeExport(data: any, filterLabel: string): ExportOptions {
  const rows: ExportRow[] = [];
  rows.push({ code: "", name: "壹、營業收入", amount: fmtNum(data.totalIncome) });
  for (const group of data.income) {
    rows.push({ code: group.groupNumber, name: `  ${group.groupName}`, amount: fmtNum(group.subtotal) });
    for (const item of group.items) {
      rows.push({ code: item.accountNumber, name: `    ${item.accountName}`, amount: fmtNum(item.amount) });
    }
  }
  rows.push({ code: "", name: "貳、營業成本及費用", amount: fmtNum(data.totalExpense) });
  for (const group of data.expense) {
    rows.push({ code: group.groupNumber, name: `  ${group.groupName}`, amount: fmtNum(group.subtotal) });
    for (const item of group.items) {
      rows.push({ code: item.accountNumber, name: `    ${item.accountName}`, amount: fmtNum(item.amount) });
    }
  }
  rows.push({ code: "", name: "參、本期淨損益", amount: fmtNum(data.netProfit) });

  return {
    title: "損益表",
    subtitle: `期間：${data.startDate || "期初"} 至 ${data.endDate || "今日"}${filterLabel !== "全部" ? ` （${filterLabel}）` : ""}`,
    fileName: `損益表_${data.startDate || "期初"}_${data.endDate || "今日"}`,
    headers: ["科目代碼", "科目名稱", "金額"],
    columnKeys: ["code", "name", "amount"],
    rows,
    columnWidths: [12, 30, 15],
  };
}

export function buildCrossIncomeExport(crossData: any): ExportOptions {
  const cols = crossData.columns as { id: string; name: string }[];
  const headers = ["科目代碼", "科目名稱", "全部合計", ...cols.map((c: any) => c.name)];
  const columnKeys = ["code", "name", "total", ...cols.map((c: any) => `col_${c.id}`)];
  const rows: ExportRow[] = [];

  rows.push(buildCrossSummaryRow("壹、營業收入", crossData.totalIncome, cols, crossData.columnTotals, "income"));
  for (const row of crossData.incomeRows) {
    rows.push(buildCrossDetailRow(row, cols));
  }
  rows.push(buildCrossSummaryRow("貳、營業成本及費用", crossData.totalExpense, cols, crossData.columnTotals, "expense"));
  for (const row of crossData.expenseRows) {
    rows.push(buildCrossDetailRow(row, cols));
  }
  rows.push(buildCrossSummaryRow("參、本期淨損益", crossData.netProfit, cols, crossData.columnTotals, "net"));

  const dimLabel = crossData.dimension === "project" ? "專案" : "部門";
  return {
    title: `損益表 — ${dimLabel}橫向比較`,
    subtitle: `期間：${crossData.startDate || "期初"} 至 ${crossData.endDate || "今日"}`,
    fileName: `損益表_橫向_${dimLabel}_${crossData.startDate || "期初"}_${crossData.endDate || "今日"}`,
    headers,
    columnKeys,
    rows,
  };
}

export function buildVerticalBalanceExport(data: any, filterLabel: string): ExportOptions {
  const rows: ExportRow[] = [];

  rows.push({ code: "", name: "壹、資產", amount: fmtNum(data.totalAssets) });
  for (const group of data.assets.groups) {
    rows.push({ code: group.groupNumber, name: `  ${group.groupName}`, amount: fmtNum(group.subtotal) });
    for (const item of group.items) {
      rows.push({ code: item.accountNumber, name: `    ${item.accountName}`, amount: fmtNum(item.amount) });
    }
  }
  rows.push({ code: "", name: "貳、負債", amount: fmtNum(data.liabilities.total) });
  for (const group of data.liabilities.groups) {
    rows.push({ code: group.groupNumber, name: `  ${group.groupName}`, amount: fmtNum(group.subtotal) });
    for (const item of group.items) {
      rows.push({ code: item.accountNumber, name: `    ${item.accountName}`, amount: fmtNum(item.amount) });
    }
  }
  rows.push({ code: "", name: "參、權益", amount: fmtNum(data.equity.totalWithRetainedEarnings) });
  for (const group of data.equity.groups) {
    rows.push({ code: group.groupNumber, name: `  ${group.groupName}`, amount: fmtNum(group.subtotal) });
    for (const item of group.items) {
      rows.push({ code: item.accountNumber, name: `    ${item.accountName}`, amount: fmtNum(item.amount) });
    }
  }
  if (data.equity.retainedEarnings !== 0) {
    rows.push({ code: "-", name: "    本期損益（保留盈餘）", amount: fmtNum(data.equity.retainedEarnings) });
  }
  rows.push({ code: "", name: "負債及權益合計", amount: fmtNum(data.totalLiabilitiesAndEquity) });

  return {
    title: "資產負債表",
    subtitle: `截止日期：${data.endDate || "今日"}${filterLabel !== "全部" ? ` （${filterLabel}）` : ""}`,
    fileName: `資產負債表_${data.endDate || "今日"}`,
    headers: ["科目代碼", "科目名稱", "餘額"],
    columnKeys: ["code", "name", "amount"],
    rows,
    columnWidths: [12, 30, 15],
  };
}

export function buildCrossBalanceExport(crossData: any): ExportOptions {
  const cols = crossData.columns as { id: string; name: string }[];
  const headers = ["科目代碼", "科目名稱", "全部合計", ...cols.map((c: any) => c.name)];
  const columnKeys = ["code", "name", "total", ...cols.map((c: any) => `col_${c.id}`)];
  const rows: ExportRow[] = [];

  rows.push(buildCrossSummaryRow("壹、資產", crossData.totalAssets, cols, crossData.columnTotals, "assets"));
  for (const row of crossData.assetRows) {
    rows.push(buildCrossDetailRow(row, cols));
  }
  rows.push(buildCrossSummaryRow("貳、負債", crossData.totalLiabilities, cols, crossData.columnTotals, "liabilities"));
  for (const row of crossData.liabilityRows) {
    rows.push(buildCrossDetailRow(row, cols));
  }

  const equityTotal = crossData.totalEquityWithRetained;
  const eRow: ExportRow = { code: "", name: "參、權益", total: fmtNum(equityTotal) };
  for (const c of cols) {
    const ct = crossData.columnTotals[c.id];
    eRow[`col_${c.id}`] = fmtNum((ct?.equity || 0) + (ct?.retained || 0));
  }
  rows.push(eRow);

  for (const row of crossData.equityRows) {
    rows.push(buildCrossDetailRow(row, cols));
  }
  if (crossData.retainedEarnings.totalAmount !== 0) {
    const rRow: ExportRow = { code: "-", name: "本期損益（保留盈餘）", total: fmtNum(crossData.retainedEarnings.totalAmount) };
    for (const c of cols) {
      rRow[`col_${c.id}`] = fmtNum(crossData.retainedEarnings.breakdown[c.id] || 0);
    }
    rows.push(rRow);
  }

  const leRow: ExportRow = { code: "", name: "負債及權益合計", total: fmtNum(crossData.totalLiabilities + crossData.totalEquityWithRetained) };
  for (const c of cols) {
    const ct = crossData.columnTotals[c.id];
    leRow[`col_${c.id}`] = fmtNum((ct?.liabilities || 0) + (ct?.equity || 0) + (ct?.retained || 0));
  }
  rows.push(leRow);

  const dimLabel = crossData.dimension === "project" ? "專案" : "部門";
  return {
    title: `資產負債表 — ${dimLabel}橫向比較`,
    subtitle: `截止日期：${crossData.endDate || "今日"}`,
    fileName: `資產負債表_橫向_${dimLabel}_${crossData.endDate || "今日"}`,
    headers,
    columnKeys,
    rows,
  };
}

function fmtNum(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function buildCrossDetailRow(row: any, cols: { id: string; name: string }[]): ExportRow {
  const r: ExportRow = {
    code: row.accountNumber,
    name: row.accountName,
    total: fmtNum(row.totalAmount),
  };
  for (const c of cols) {
    r[`col_${c.id}`] = fmtNum(row.breakdown[c.id] || 0);
  }
  return r;
}

function buildCrossSummaryRow(label: string, total: number, cols: { id: string; name: string }[], columnTotals: any, key: string): ExportRow {
  const r: ExportRow = { code: "", name: label, total: fmtNum(total) };
  for (const c of cols) {
    r[`col_${c.id}`] = fmtNum(columnTotals[c.id]?.[key] || 0);
  }
  return r;
}
