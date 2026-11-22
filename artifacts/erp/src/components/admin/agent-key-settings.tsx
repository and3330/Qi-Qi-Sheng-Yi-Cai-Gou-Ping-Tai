/**
 * API 金鑰的「開放給 AI 助理（Claude、Grok、ChatGPT 這類，透過 MCP 連進來）」開關。
 * 金鑰沒有自己的權限（老闆 2026-11-19）：AI 能做什麼完全跟著金鑰代表的那個使用者的角色。
 */
export interface AgentConfig { enabled: boolean }

export const DEFAULT_AGENT: AgentConfig = { enabled: false };

export function agentSummary(config: AgentConfig | null | undefined): string {
  return config?.enabled ? "已開放" : "未開放";
}

export function AgentKeySettings({ value, onChange }: { value: AgentConfig; onChange: (next: AgentConfig) => void }) {
  return (
    <div className="space-y-2 rounded-lg border p-4" data-testid="agent-key-settings">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.enabled} onChange={e => onChange({ enabled: e.target.checked })} data-testid="agent-enabled" />
        <span>
          <span className="block text-sm font-medium">開放給 AI 助理連線（MCP）</span>
          <span className="block text-xs text-muted-foreground">打勾後，Claude、Grok、ChatGPT 這類 AI 助理可以用這把金鑰連進 ERP。沒打勾的金鑰只能用在一般的系統串接。</span>
        </span>
      </label>
      {value.enabled && (
        <p className="text-xs text-muted-foreground">
          AI 能做的事跟這把金鑰代表的人一模一樣，連上後會先告訴它「你是誰、能做什麼」。帳號、金鑰、備份、訂閱、權限與系統設定、關帳年結、審批，仍然只能由人在 ERP 操作。
        </p>
      )}
    </div>
  );
}

/** 怎麼把 AI 助理接上來（顯示在金鑰頁面最下面，也顯示在剛建立金鑰的提示裡） */
export function McpHowTo({ token }: { token?: string }) {
  const url = `${window.location.origin}/mcp`;
  const bearer = token ?? "<API_KEY>:<API_SECRET>";
  return (
    <div className="space-y-2 text-sm" data-testid="mcp-how-to">
      <p><strong>AI 助理（MCP）連線</strong>：金鑰要先打勾「開放給 AI 助理連線」。</p>
      <p>1. 連線網址（Streamable HTTP）</p>
      <code className="block overflow-x-auto rounded bg-blue-100 px-3 py-2 text-xs dark:bg-blue-900">{url}</code>
      <p>2. 驗證標頭（API Key 和 Secret 中間用冒號接起來）</p>
      <code className="block overflow-x-auto rounded bg-blue-100 px-3 py-2 text-xs dark:bg-blue-900">Authorization: Bearer {bearer}</code>
      <p>3. Claude Code 可以直接貼這一行（把金鑰換成自己的）：</p>
      <code className="block overflow-x-auto whitespace-pre rounded bg-blue-100 px-3 py-2 text-xs dark:bg-blue-900">{`claude mcp add --transport http erp ${url} --header "Authorization: Bearer ${bearer}"`}</code>
      <p className="text-xs">其他 AI 工具在「新增 MCP 伺服器／自訂連接器」填同樣的網址和標頭即可。接上後先請 AI 呼叫 erp_whoami，它會說明這把金鑰代表誰、能做哪些事。</p>
    </div>
  );
}
