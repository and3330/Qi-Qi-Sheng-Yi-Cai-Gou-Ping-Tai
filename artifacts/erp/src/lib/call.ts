/** 新頁面共用的小工具：呼叫後端、金額格式、原生下拉選單的樣式 */

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/erp-api/${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (response.status === 204) return undefined as T;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json as T;
}

export const post = <T,>(path: string, body?: unknown, method = "POST") =>
  call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const money = (n: number | string | null | undefined) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;

export const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export const todayText = () => {
  const now = new Date(Date.now() + 8 * 3600_000);
  return now.toISOString().slice(0, 10);
};
