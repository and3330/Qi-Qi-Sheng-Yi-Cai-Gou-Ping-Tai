import { AsyncLocalStorage } from "node:async_hooks";
import type { UserProfile } from "./user-identity";

/**
 * 每一把 API 金鑰可以各自設定「AI 助理（MCP）能做什麼」（老闆 2026-11-17）。
 *
 * 身分決定看得到哪些工具（唯讀／業務／財務／全權）。
 * 另外四類原本「只留給人」的動作，每一把金鑰各自選一種做法：
 *   deny   不可以
 *   review 可以送出，但要人在 ERP 核准才生效（進「異動申請」）
 *   direct 直接生效，跟登入的人自己操作一樣（已入帳單據原本就要送審的，照樣送審）
 *
 * 不管怎麼設都不開放：帳號、API 金鑰、備份、訂閱、權限與系統設定。
 * 金鑰不能替自己加權限。
 */
export type ActionMode = "deny" | "review" | "direct";
export type ActionCategory = "reverse" | "pay" | "delete" | "approve";
export type AgentRole = "readonly" | "sales" | "finance" | "admin";

export const ACTION_CATEGORIES: ActionCategory[] = ["reverse", "pay", "delete", "approve"];
export const ACTION_LABELS: Record<ActionCategory, string> = {
  reverse: "沖銷、作廢、取消",
  pay: "付款、發薪、還款",
  delete: "刪除",
  approve: "核准、駁回",
};
const MODES: ActionMode[] = ["deny", "review", "direct"];
const ROLES: AgentRole[] = ["readonly", "sales", "finance", "admin"];

export type AgentActions = Record<ActionCategory, ActionMode>;
export interface AgentConfig { enabled: boolean; role: AgentRole; actions: AgentActions }

export const NO_ACTIONS: AgentActions = { reverse: "deny", pay: "deny", delete: "deny", approve: "deny" };
export const MAX_ACTIONS: AgentActions = { reverse: "direct", pay: "direct", delete: "direct", approve: "direct" };

/** 存進資料庫前、讀出來用之前都過這裡：不認得的值一律當成最保守的 */
export function parseAgentConfig(raw: unknown): AgentConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (o.actions && typeof o.actions === "object" ? o.actions : {}) as Record<string, unknown>;
  const actions = { ...NO_ACTIONS };
  for (const c of ACTION_CATEGORIES) if (MODES.includes(a[c] as ActionMode)) actions[c] = a[c] as ActionMode;
  return { enabled: o.enabled === true, role: ROLES.includes(o.role as AgentRole) ? (o.role as AgentRole) : "readonly", actions };
}

/**
 * 這次 MCP 呼叫是哪一把金鑰（環境變數的舊金鑰沒有這個，四類動作一律不可以）。
 * ERP 金鑰會帶上綁定的使用者（profile）：可用的工具與能做的動作都跟著那個人的角色。
 */
export interface AgentContext { keyId: number | null; keyName: string; actions: AgentActions; profile?: UserProfile }
const store = new AsyncLocalStorage<AgentContext>();
export const runWithAgent = <T>(agent: AgentContext, fn: () => T): T => store.run(agent, fn);
export const currentAgent = (): AgentContext | undefined => store.getStore();
