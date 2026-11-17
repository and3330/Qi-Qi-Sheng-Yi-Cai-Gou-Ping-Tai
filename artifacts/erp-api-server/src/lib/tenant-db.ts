import { currentTenantClient } from "@workspace/erp-db";
type TenantClient = NonNullable<ReturnType<typeof currentTenantClient>>;

/**
 * 租戶範圍的 pool 相容介面：所有查詢都走目前請求的租戶連線（RLS 生效）。
 * 不在租戶上下文時直接拋錯（fail-closed），避免任何跨租戶存取。
 * 注意：connect() 回傳的是同一條請求專屬連線，release 為 no-op，
 * 交易（BEGIN/COMMIT）可正常使用。
 */
function requireClient(): TenantClient {
  const c = currentTenantClient();
  if (!c) throw new Error("此操作必須在租戶上下文中執行（tenant context missing）");
  return c;
}

export const tenantPool = {
  query: (text: string, params?: any[]) => requireClient().query(text, params),
  connect: async () => {
    const c = requireClient();
    return {
      query: (text: string, params?: any[]) => c.query(text, params),
      release: () => { /* 請求結束時由 runWithTenant 統一歸還 */ },
    };
  },
};
