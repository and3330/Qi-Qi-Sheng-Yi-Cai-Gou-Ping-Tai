import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Globe, Lock, FileText, Code, Search } from "lucide-react";

interface EndpointInfo {
  method: string;
  path: string;
  description: string;
}

interface CatalogResource { resource: string; label: string; endpoints: EndpointInfo[] }
interface CatalogModule { module: string; resources: CatalogResource[]; endpointCount: number }
interface Catalog { total: number; modules: CatalogModule[] }

const methodColors: Record<string, string> = {
  GET: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  PATCH: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  PUT: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function ApiDocs() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showExample, setShowExample] = useState(false);

  const toggle = (name: string) => setExpanded((p) => ({ ...p, [name]: !p[name] }));

  const [search, setSearch] = useState("");
  // 端點清單由伺服器從實際的路由整理出來，新增功能後這一頁會自動跟著更新
  const { data: catalog, isLoading, isError } = useQuery<Catalog>({
    queryKey: ["api-catalog"],
    queryFn: async () => { const res = await fetch("/erp-api/api-catalog"); if (!res.ok) throw new Error("讀取失敗"); return res.json(); },
    staleTime: 5 * 60 * 1000,
  });
  const totalEndpoints = catalog?.total ?? 0;
  const q = search.trim().toLowerCase();
  const modules = useMemo(() => (catalog?.modules ?? []).map((m) => {
    const endpoints = m.resources.flatMap((r) => r.endpoints.map((e) => ({ ...e, label: r.label })));
    const shown = q ? endpoints.filter((e) => `${e.method} ${e.path} ${e.description} ${e.label} ${m.module}`.toLowerCase().includes(q)) : endpoints;
    return { name: m.module, description: m.resources.map((r) => r.label).join("、"), endpoints: shown };
  }).filter((m) => m.endpoints.length > 0), [catalog, q]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API 文件</h1>
        <p className="text-muted-foreground">所有模組的 REST API 端點，共 {totalEndpoints} 個。這份清單直接從系統讀出來，功能更新後會自動跟著變。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
            <Globe size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{totalEndpoints}</div>
            <div className="text-xs text-muted-foreground">API 端點總數</div>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <FileText size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">{modules.length}</div>
            <div className="text-xs text-muted-foreground">功能模組</div>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            <Lock size={20} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <div className="text-2xl font-bold">REST</div>
            <div className="text-xs text-muted-foreground">JSON API 格式</div>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Code size={18} />
            快速開始
          </h3>
          <button
            onClick={() => setShowExample(!showExample)}
            className="text-sm text-primary hover:underline"
          >
            {showExample ? "隱藏範例" : "顯示範例"}
          </button>
        </div>
        <div className="text-sm space-y-2 text-muted-foreground">
          <p>1. 前往 <strong>系統管理 → API 金鑰</strong> 建立一組新的 API Key / Secret</p>
          <p>2. 在 HTTP 請求中加入驗證標頭</p>
          <p>3. 呼叫任何 <code>/erp-api/</code> 端點即可存取資料</p>
        </div>
        {showExample && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">cURL 範例</div>
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto">
{`# 方式一：Bearer Token
curl -H "Authorization: Bearer erpk_xxx:erps_xxx" \\
     https://your-domain/api/customers

# 方式二：自訂標頭
curl -H "X-API-Key: erpk_xxx" \\
     -H "X-API-Secret: erps_xxx" \\
     https://your-domain/api/customers

# 新增客戶（POST）
curl -X POST \\
     -H "Authorization: Bearer erpk_xxx:erps_xxx" \\
     -H "Content-Type: application/json" \\
     -d '{"name":"測試客戶","email":"test@example.com"}' \\
     https://your-domain/api/customers`}
              </pre>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">JavaScript (fetch) 範例</div>
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto">
{`const API_KEY = "erpk_xxx";
const API_SECRET = "erps_xxx";
const BASE_URL = "https://your-domain";

const res = await fetch(\`\${BASE_URL}/erp-api/customers\`, {
  headers: {
    "Authorization": \`Bearer \${API_KEY}:\${API_SECRET}\`,
    "Content-Type": "application/json",
  },
});
const customers = await res.json();
console.log(customers);`}
              </pre>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Python (requests) 範例</div>
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto">
{`import requests

API_KEY = "erpk_xxx"
API_SECRET = "erps_xxx"
BASE_URL = "https://your-domain"

headers = {
    "X-API-Key": API_KEY,
    "X-API-Secret": API_SECRET,
}

# 取得所有客戶
resp = requests.get(f"{BASE_URL}/erp-api/customers", headers=headers)
print(resp.json())

# 新增客戶
resp = requests.post(f"{BASE_URL}/erp-api/customers", headers=headers, json={
    "name": "測試客戶",
    "email": "test@example.com"
})
print(resp.json())`}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          placeholder="搜尋端點：可以打中文（合約、請款、物料清單）或路徑（hr-contracts）"
          value={search} onChange={(e) => setSearch(e.target.value)} aria-label="搜尋端點"
        />
      </div>
      {isLoading && <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">載入中…</div>}
      {isError && <div className="rounded-xl border bg-card p-6 text-sm text-red-600">讀不到 API 目錄，請重新整理；只有老闆與管理員可以看這一頁。</div>}
      {!isLoading && !isError && modules.length === 0 && <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">沒有符合「{search}」的端點</div>}

      <div className="space-y-2">
        {modules.map((mod) => (
          <div key={mod.name} className="bg-card border rounded-xl overflow-hidden">
            <button
              onClick={() => toggle(mod.name)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expanded[mod.name] || q ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <div className="text-left">
                  <div className="font-medium">{mod.name}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{mod.description}</div>
                </div>
              </div>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{mod.endpoints.length} 個端點</span>
            </button>
            {(expanded[mod.name] || !!q) && (
              <div className="overflow-x-auto border-t">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="text-left px-5 py-2 font-medium w-20">方法</th>
                      <th className="text-left px-5 py-2 font-medium">路徑</th>
                      <th className="text-left px-5 py-2 font-medium">說明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mod.endpoints.map((ep, i) => (
                      <tr key={i} className="border-t hover:bg-muted/20">
                        <td className="px-5 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${methodColors[ep.method]}`}>
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-5 py-2">
                          <code className="text-xs">/api{ep.path}</code>
                        </td>
                        <td className="px-5 py-2 text-muted-foreground">{ep.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
