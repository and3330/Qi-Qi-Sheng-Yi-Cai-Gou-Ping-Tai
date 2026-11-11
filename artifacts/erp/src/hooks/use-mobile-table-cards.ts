import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * 手機上把頁面裡的表格自動改成「一筆一張卡片」，不用左右滑。
 *
 * 做法：讀表頭文字，寫到每個儲存格的 data-label，再由 index.css 的樣式把每一列排成卡片。
 * 只加 data-* 屬性，不動 React 管理的 class 與內容，所以各頁面的程式不用改。
 *
 * 不轉換的情況（維持原本的左右滑動，第一欄固定）：
 * - 表格或外層標了 data-no-cards
 * - 沒有表頭、有跨列儲存格（rowSpan）、欄位超過 MAX_COLUMNS（例如整個月的出勤矩陣）
 * - 少於 MIN_COLUMNS 欄而且手機放得下
 */
const MIN_COLUMNS = 4;
const MAX_COLUMNS = 14;
const ACTION_LABELS = new Set(["操作", "動作", "功能", "管理"]);

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** 取表頭最後一列的文字，跨欄的表頭會重複填入對應的每一欄 */
function headerLabels(table: HTMLTableElement): string[] | null {
  const rows = table.tHead?.rows;
  if (!rows || rows.length === 0) return null;
  const labels: string[] = [];
  for (const cell of Array.from(rows[rows.length - 1].cells)) {
    const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < Math.max(1, cell.colSpan); i++) labels.push(text);
  }
  return labels;
}

function shouldConvert(table: HTMLTableElement, labels: string[]): boolean {
  if (table.closest("[data-no-cards]")) return false;
  if (labels.length > MAX_COLUMNS) return false;
  if (table.querySelector(":scope > tbody > tr > [rowspan]:not([rowspan='1'])")) return false;
  if (labels.length >= MIN_COLUMNS) return true;
  // 欄位少的表格，手機放得下就維持表格
  const box = table.parentElement;
  return !!box && box.clientWidth > 0 && table.scrollWidth > box.clientWidth + 4;
}

function labelRow(row: HTMLTableRowElement, labels: string[], titleIndex: number) {
  let col = 0;
  for (const cell of Array.from(row.cells)) {
    const span = Math.max(1, cell.colSpan);
    const label = labels[col] ?? "";
    let role: string;
    if (span > 1) role = "full";
    else if (col === titleIndex) role = "title";
    else if (ACTION_LABELS.has(label)) role = "actions";
    // 標題前面沒有名稱的欄位是勾選框，放卡片右上角
    else if (label === "" && col < titleIndex) role = "check";
    else if (label === "") role = "actions";
    else role = "field";
    setAttr(cell, "data-m-role", role);
    setAttr(cell, "data-label", (role === "field" || role === "title") && label ? label : null);
    col += span;
  }
}

function processTable(table: HTMLTableElement) {
  const labels = headerLabels(table);
  if (!labels) return;
  if (!table.hasAttribute("data-m-cards") && !shouldConvert(table, labels)) return;
  setAttr(table, "data-m-cards", "");
  // 卡片標題：第一個有名稱、不是操作欄的欄位
  const titleIndex = labels.findIndex((l) => l !== "" && !ACTION_LABELS.has(l));
  // 表頭裡的「全選」勾選框：標記起來，卡片模式下單獨顯示成一列
  const headRow = table.tHead!.rows[table.tHead!.rows.length - 1];
  let headCol = 0;
  for (const cell of Array.from(headRow.cells)) {
    const isSelectAll = headCol < titleIndex && (cell.textContent || "").trim() === "" && cell.childElementCount > 0;
    setAttr(cell, "data-m-role", isSelectAll ? "check" : null);
    headCol += Math.max(1, cell.colSpan);
  }
  const sections = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const section of sections) {
    const inFoot = section.tagName === "TFOOT";
    for (const row of Array.from(section.rows)) labelRow(row, labels, inFoot ? -1 : titleIndex);
  }
}

/** 頂部標題列已經顯示頁面名稱時，頁面裡同名的大標題不用再顯示一次（保留給螢幕閱讀器） */
function hideDuplicateTitle() {
  const bar = document.querySelector("[data-testid='text-mobile-title']");
  const barTitle = (bar?.textContent || "").trim();
  document.querySelectorAll("main h1").forEach((h1) => {
    const same = barTitle !== "" && (h1.textContent || "").trim() === barTitle;
    setAttr(h1, "data-m-dup-title", same ? "" : null);
  });
}

export function useMobileTableCards() {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isMobile || typeof MutationObserver === "undefined") return;
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>("table").forEach(processTable);
      hideDuplicateTitle();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    schedule();
    // 只看節點增減（資料載入、換頁、開對話框）；我們自己改的是屬性，不會再觸發
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isMobile]);
}
