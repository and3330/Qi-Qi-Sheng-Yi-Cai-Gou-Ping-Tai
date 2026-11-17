import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * 全域「資料已變更」自動刷新機制。
 *
 * 原理：攔截 window.fetch，凡是對 /api 的寫入請求（POST/PATCH/PUT/DELETE）
 * 成功後就廣播 erp:data-changed 事件，並讓 react-query 的所有查詢失效重抓。
 * 各頁面用 useAutoReloadKey() 取得一個版本號，放進 useEffect 依賴陣列，
 * 事件發生時版本號 +1 → 頁面自動重新載入資料，不必手動重新整理。
 */

export const DATA_CHANGED_EVENT = "erp:data-changed";

const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
// 這些路徑的寫入不代表業務資料變更，不觸發全域刷新
const IGNORED_PATTERNS = [/\/erp-api\/ai\//, /\/erp-api\/admin\/login/, /\/erp-api\/admin\/logout/, /\/erp-api\/auth\//];

let installed = false;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyDataChanged(queryClient: QueryClient) {
  // 短暫防抖：批次操作連續多次寫入時只刷新一次
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    queryClient.invalidateQueries();
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
  }, 300);
}

export function installAutoRefresh(queryClient: QueryClient) {
  if (installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    try {
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (MUTATION_METHODS.has(method) && response.ok) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/erp-api/") && !IGNORED_PATTERNS.some((p) => p.test(url))) {
          notifyDataChanged(queryClient);
        }
      }
    } catch {
      // 刷新通知失敗不影響原本的請求結果
    }
    return response;
  };
}

/**
 * 頁面自動刷新鉤子：回傳一個版本號，放進資料載入 useEffect 的依賴陣列，
 * 任何寫入操作成功後版本號會 +1，該 useEffect 便會重新執行（重新抓資料）。
 */
export function useAutoReloadKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const handler = () => setKey((k) => k + 1);
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, []);
  return key;
}
