import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSession, getChatSession, retainChatScope } from "../ai-chat-session";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

afterEach(() => { retainChatScope(null); vi.unstubAllGlobals(); });

describe("AI conversation retention", () => {
  it("retains messages, input and attachments across route subscribers", () => {
    const session = getChatSession("company:user:role");
    const notify = vi.fn();
    const unsubscribe = session.subscribe(notify);
    session.set("messages", [{ id: session.nextId(), role: "user", text: "營收？" }]);
    session.set("input", "下個問題");
    session.set("attachments", [{ name: "receipt", type: "image/jpeg", data: "image", preview: "" }]);
    unsubscribe();
    const returning = getChatSession("company:user:role");
    expect(returning).toBe(session);
    expect(returning.getSnapshot()).toMatchObject({
      input: "下個問題", messages: [{ text: "營收？" }], attachments: [{ name: "receipt" }],
    });
  });

  it("accepts a late reply after leaving the page without duplicate IDs", async () => {
    const session = getChatSession("company:user:role");
    const firstId = session.nextId();
    session.set("sending", true);
    const returning = getChatSession("company:user:role");
    expect(returning.getSnapshot().sending).toBe(true);
    await Promise.resolve();
    session.set("messages", (previous) => [...previous, { id: session.nextId(), role: "assistant", text: "完成" }]);
    session.set("sending", false);
    expect(returning.getSnapshot().messages[0].id).toBeGreaterThan(firstId);
    expect(returning.getSnapshot().sending).toBe(false);
  });

  it("restores text after reload, without storing image bytes or approval tokens", () => {
    const storage = memoryStorage();
    const session = new ChatSession("chat", storage);
    session.set("input", "草稿文字");
    session.set("attachments", [{ name: "photo", type: "image/jpeg", data: "PRIVATE_IMAGE", preview: "blob:private" }]);
    session.set("messages", [{
      id: session.nextId(), role: "assistant", text: "請確認", photos: ["blob:private"],
      pending: { token: "PRIVATE_APPROVAL", summary: "建立", items: [] }, pendingState: "waiting",
    }]);
    const saved = storage.getItem("chat")!;
    expect(saved).not.toContain("PRIVATE_IMAGE");
    expect(saved).not.toContain("blob:private");
    expect(saved).not.toContain("PRIVATE_APPROVAL");
    const restored = new ChatSession("chat", storage);
    expect(restored.getSnapshot()).toMatchObject({
      input: "草稿文字", attachments: [], sending: false,
      messages: [{ text: "請確認", pendingState: "expired", pending: { token: "" } }],
    });
    expect(session.getSnapshot().messages[0].pendingState).toBe("waiting");
  });

  it("warns about interrupted requests after reload rather than replaying them", () => {
    const storage = memoryStorage();
    const session = new ChatSession("chat", storage);
    session.set("messages", [{ id: 4, role: "user", text: "確認" }]);
    session.set("sending", true);
    const restored = new ChatSession("chat", storage);
    expect(restored.getSnapshot().sending).toBe(false);
    expect(restored.getSnapshot().messages.at(-1)?.text).toContain("避免重複操作");
    expect(restored.nextId()).toBe(6);
  });

  it("keeps different accounts and tenants separate and ignores logged-out callbacks", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    const first = getChatSession("tenant1:user1:admin");
    first.set("input", "private");
    const second = getChatSession("tenant2:user1:admin");
    expect(second.getSnapshot().input).toBe("");
    retainChatScope("tenant2:user1:admin");
    first.set("input", "late private reply");
    expect(storage.getItem("erp-ai-chat:v1:tenant1:user1:admin")).toBeNull();
    retainChatScope(null);
    second.set("input", "late reply after logout");
    expect(storage.length).toBe(0);
  });

  it("keeps only the current user's saved conversation on initial auth refresh", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    storage.setItem("erp-ai-chat:v1:current", "current history");
    storage.setItem("erp-ai-chat:v1:other", "other history");
    storage.setItem("unrelated", "keep");
    retainChatScope("current");
    expect(storage.getItem("erp-ai-chat:v1:current")).toBe("current history");
    expect(storage.getItem("erp-ai-chat:v1:other")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("clears saved messages only when explicitly cleared", () => {
    const storage = memoryStorage();
    const session = new ChatSession("chat", storage);
    session.set("messages", [{ id: 1, role: "user", text: "question" }]);
    session.set("messages", []);
    expect(new ChatSession("chat", storage).getSnapshot().messages).toEqual([]);
  });

  it("keeps navigation usable when storage is full or malformed", () => {
    const storage = memoryStorage();
    storage.setItem("chat", "{broken");
    const session = new ChatSession("chat", storage);
    expect(session.getSnapshot().messages).toEqual([]);
    storage.setItem = () => { throw new Error("quota"); };
    session.set("input", "retained in memory");
    expect(session.getSnapshot()).toMatchObject({ input: "retained in memory", storageError: true });
  });
});
