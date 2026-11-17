import { describe, expect, it } from "vitest";
import {
  agentPrompt, capTrace, checkWrite, compact, describeCreated, normalizeStep, pageFor, parseImages, rankByName, signPending, tableFrom, verifyPending,
  TOOL_RESULT_PREFIX, type PendingState,
} from "../ai-agent";
import { judgeRequest } from "../../mcp/admin-guard";

describe("AI 對話：步驟的檢查", () => {
  it("查詢類的步驟整理成固定格式", () => {
    expect(normalizeStep({ action: "find", kind: "customer", name: " 陽光幼兒園 " })).toEqual({ action: "find", kind: "customer", name: "陽光幼兒園" });
    expect(normalizeStep({ action: "query", question: "本月營收" })).toEqual({ action: "query", question: "本月營收" });
    expect(normalizeStep({ action: "get", path: "/api/sales-orders/3/", query: { search: "A", bad: { x: 1 }, "no good": "x" }, show: true }))
      .toEqual({ action: "get", path: "/sales-orders/3", query: { search: "A" }, show: true });
    expect(normalizeStep({ action: "quotation_pdf", quotation_id: "12" })).toEqual({ action: "quotation_pdf", quotationId: 12 });
    expect(normalizeStep({ action: "final", text: "好了" })).toEqual({ action: "final", text: "好了" });
  });

  it("格式不對或不認得的步驟一律不執行，並說明原因", () => {
    for (const raw of [null, "final", [], {}, { action: "delete_everything" }, { action: "find", kind: "password" }, { action: "query" },
      { action: "final", text: "" }, { action: "write", requests: [] }, { action: "quotation_pdf", quotation_id: -1 },
      { action: "send_quotation_pdf", quotation_id: 1, email: "不是信箱" }, { action: "feature", name: "drop_tables" }]) {
      const step = normalizeStep(raw);
      expect(step.action).toBe("invalid");
    }
  });

  it("帳號、金鑰、備份讀不到；AI 功能不能繞路呼叫", () => {
    for (const path of ["/admin/users", "/api-keys", "/backup/list", "/users", "/ai/chat", "/items/../admin/users", "http://evil.test/x"]) {
      expect(normalizeStep({ action: "get", path }).action).toBe("invalid");
    }
  });

  it("寫入會排進確認清單；付款、作廢、刪除要特別提醒", () => {
    const step = normalizeStep({ action: "write", summary: "建客戶", requests: [{ method: "post", path: "/customers", body: { name: "陽光幼兒園" }, label: "新增客戶：陽光幼兒園" }] });
    expect(step).toEqual({ action: "write", summary: "建客戶", items: [{ type: "request", method: "POST", path: "/customers", body: { name: "陽光幼兒園" }, label: "新增客戶：陽光幼兒園" }] });

    const pay = checkWrite({ method: "PATCH", path: "/payment-requests/9", body: { status: "Paid" } });
    expect(pay.ok && pay.request.sensitive).toContain("錢付出去");
    const voided = checkWrite({ method: "POST", path: "/invoices/3/void", body: {} });
    expect(voided.ok && voided.request.sensitive).toContain("作廢");
    const removed = checkWrite({ method: "DELETE", path: "/customers/3" });
    expect(removed.ok && removed.request.sensitive).toContain("刪除");
    const plain = checkWrite({ method: "POST", path: "/sales-orders", body: { customerId: 1 } });
    expect(plain.ok && plain.request.sensitive).toBeUndefined();
    // 沒寫 label 時至少看得到是哪個動作
    expect(plain.ok && plain.request.label).toBe("POST /sales-orders");
  });

  it("就算使用者會確認，帳號金鑰區與系統設定還是不能改", () => {
    for (const request of [
      { method: "POST", path: "/admin/users", body: {} }, { method: "POST", path: "/api-keys", body: {} },
      { method: "PUT", path: "/accounting-settings", body: { lockDate: "2020-01-01" } }, { method: "POST", path: "/backup/run", body: {} },
      { method: "POST", path: "/ai/chat", body: {} }, { method: "GET", path: "/customers" }, { method: "POST", path: "customers" },
    ]) {
      expect(checkWrite(request).ok).toBe(false);
    }
    expect(normalizeStep({ action: "write", requests: [{ method: "POST", path: "/customers", body: {} }, { method: "POST", path: "/api-keys", body: {} }] }).action).toBe("invalid");
    expect(normalizeStep({ action: "write", requests: Array.from({ length: 9 }, () => ({ method: "POST", path: "/customers", body: {} })) }).action).toBe("invalid");
  });

  it("外接 AI（沒有人確認）的規則沒有變鬆", () => {
    expect(judgeRequest("PATCH", "/payment-requests/9", { status: "Paid" }).allowed).toBe(false);
    expect(judgeRequest("DELETE", "/customers/1", undefined).allowed).toBe(false);
    expect(judgeRequest("PATCH", "/payment-requests/9", { status: "Paid" }, { humanConfirmed: true }).allowed).toBe(true);
    expect(judgeRequest("POST", "/api-keys", {}, { humanConfirmed: true }).allowed).toBe(false);
  });

  it("寄報價單也要先確認", () => {
    const step = normalizeStep({ action: "send_quotation_pdf", quotation_id: 7, email: "buyer@example.test", message: "請查收" });
    expect(step).toMatchObject({ action: "write", items: [{ type: "send_pdf", quotationId: 7, email: "buyer@example.test", message: "請查收" }] });
  });
});

describe("AI 對話：圖片與報銷", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString("base64");

  it("辨識收據與看圖片是認得的步驟", () => {
    expect(normalizeStep({ action: "scan_receipt" })).toEqual({ action: "scan_receipt" });
    expect(normalizeStep({ action: "read_image", question: "這是誰的名片" })).toEqual({ action: "read_image", question: "這是誰的名片" });
    expect(normalizeStep({ action: "read_image" })).toMatchObject({ action: "read_image", question: expect.stringContaining("圖片") });
    expect(normalizeStep({ action: "find", kind: "department", name: "營運" })).toEqual({ action: "find", kind: "department", name: "營運" });
  });

  it("報銷走確認單，不算高風險動作", () => {
    const checked = checkWrite({ method: "POST", path: "/reimbursement/confirm", body: { totalAmount: 1050 }, label: "報銷 1,050 元" });
    expect(checked.ok && checked.request.sensitive).toBeUndefined();
  });

  it("附圖只收真的圖片，限制張數", () => {
    const ok = parseImages([{ name: "收據.png", type: "image/png", data: PNG }, { name: "a.jpg", type: "image/jpg", data: JPEG }]);
    expect(ok.ok && ok.images.map(i => i.type)).toEqual(["image/png", "image/jpeg"]);
    expect(parseImages(undefined)).toEqual({ ok: true, images: [] });
    for (const bad of [
      "不是陣列", [{ name: "a.pdf", type: "application/pdf", data: PNG }], [{ name: "a.png", type: "image/png", data: Buffer.from("假的").toString("base64") }],
      [{ name: "a.png", type: "image/png", data: "" }], [{ name: "a.png", type: "image/png" }], Array.from({ length: 6 }, () => ({ name: "a.png", type: "image/png", data: PNG })),
    ]) {
      expect(parseImages(bad).ok).toBe(false);
    }
    // 檔名裡的路徑符號會被換掉
    const named = parseImages([{ name: "..\\..\\x/y.png", type: "image/png", data: PNG }]);
    expect(named.ok && named.images[0].name).not.toMatch(/[\\/]/);
  });

  it("提示詞會依角色說明能做的事", () => {
    const base = { today: "2026-11-13", userName: "王小明" };
    const employee = agentPrompt({ ...base, role: "employee", employeeId: 7 });
    expect(employee).toContain("員工自助帳號");
    expect(employee).toContain("是 7");
    expect(agentPrompt({ ...base, role: "owner" })).not.toContain("員工自助帳號");
    expect(agentPrompt({ ...base, role: "sales" })).toContain("權限不足");
  });
});

describe("AI 對話：名稱比對", () => {
  const rows = [{ id: 1, name: "陽光幼兒園" }, { id: 2, name: "陽光國小" }, { id: 3, name: "大樹文具股份有限公司" }, { id: 4, name: "星星補習班" }];
  const names = (row: { id: number; name: string }) => [row.name];
  it("完全相同排最前面，相近的列在後面，不相干的不出現", () => {
    expect(rankByName("陽光幼兒園", rows, names).map(r => r.id)).toEqual([1]);
    expect(rankByName("陽光", rows, names).map(r => r.id).sort()).toEqual([1, 2]);
    expect(rankByName("大樹文具", rows, names).map(r => r.id)).toEqual([3]);
    expect(rankByName("完全沒有這家", rows, names)).toEqual([]);
  });
  it("沒給關鍵字時列出前幾筆", () => {
    expect(rankByName("", rows, names)).toHaveLength(4);
  });
});

describe("AI 對話：等待確認的狀態", () => {
  const secret = "unit-test-secret-0123456789";
  const state: PendingState = {
    uid: 5, tid: 78, exp: 2_000_000_000, summary: "建客戶",
    messages: [{ role: "user", content: "新增客戶 陽光幼兒園" }],
    items: [{ type: "request", method: "POST", path: "/customers", body: { name: "陽光幼兒園" }, label: "新增客戶：陽光幼兒園" }],
  };
  it("本人、同一家公司、期限內才有效", () => {
    const token = signPending(state, secret);
    expect(verifyPending(token, secret, { uid: 5, tid: 78 }, 1_900_000_000)).toEqual(state);
    expect(verifyPending(token, secret, { uid: 6, tid: 78 }, 1_900_000_000)).toBeNull();
    expect(verifyPending(token, secret, { uid: 5, tid: 79 }, 1_900_000_000)).toBeNull();
    expect(verifyPending(token, secret, { uid: 5, tid: 78 }, 2_000_000_001)).toBeNull();
    expect(verifyPending(token, "another-secret-0123456789", { uid: 5, tid: 78 }, 1_900_000_000)).toBeNull();
  });
  it("內容被改過就無效", () => {
    const token = signPending(state, secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, items: [{ type: "request", method: "DELETE", path: "/customers/1", body: {}, label: "x" }] })).toString("base64url");
    expect(verifyPending(`${forged}.${signature}`, secret, { uid: 5, tid: 78 }, 1_900_000_000)).toBeNull();
    for (const bad of [null, 5, "", "abc", "a.b.c", `${token}x`]) expect(verifyPending(bad, secret, { uid: 5, tid: 78 }, 1_900_000_000)).toBeNull();
  });
});

describe("AI 對話：結果整理", () => {
  it("太長的結果會截短", () => {
    expect(compact({ a: 1 })).toBe('{"a":1}');
    expect(compact("x".repeat(100), 10)).toContain("已截短");
  });
  it("對話太長時先省略最舊的工具結果，保留最近的", () => {
    const long = TOOL_RESULT_PREFIX + "x".repeat(500);
    const trace = [{ role: "user" as const, content: "問題" }, { role: "user" as const, content: long }, { role: "assistant" as const, content: "{}" }, { role: "user" as const, content: long }];
    const capped = capTrace(trace, 700);
    expect(capped[0].content).toBe("問題");
    expect(capped[1].content).toContain("已省略");
    expect(capped[3].content).toBe(long);
    expect(trace[1].content).toBe(long);
  });
  it("清單整理成表格，略過巢狀欄位", () => {
    const table = tableFrom({ data: [{ id: 1, name: "A", tenantId: 9, items: [1], extra: { x: 1 } }, { id: 2, name: "B" }] });
    expect(table).toEqual({ columns: ["id", "name"], rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }], totalRows: 2 });
    expect(tableFrom({ id: 1 })).toBeUndefined();
    expect(tableFrom([])).toBeUndefined();
  });
  it("做完之後的連結與單號", () => {
    expect(pageFor("/quotations")).toEqual({ label: "開啟報價單", path: "/sales/quotations" });
    expect(pageFor("/sales-orders/3")).toEqual({ label: "開啟銷貨單", path: "/sales/orders" });
    expect(pageFor("/vouchers", { voucherType: "付款單" })?.path).toBe("/accounting/payments");
    expect(pageFor("/vouchers", { voucherType: "收款單" })?.path).toBe("/accounting/receipts");
    expect(pageFor("/something-else")).toBeUndefined();
    expect(describeCreated({ id: 12, quotationNumber: "QT00012", status: "Draft" })).toBe("單號 QT00012，編號 12，狀態 Draft");
    expect(describeCreated(null)).toBe("");
  });
});

describe("AI 對話：報銷明細與總額對齊", () => {
  it("明細是未稅小計時，把稅額攤回明細，合計等於含稅總額", async () => {
    const { reconcileReimbursementItems } = await import("../ai-agent");
    const fixed = reconcileReimbursementItems({ totalAmount: 1050, taxAmount: 50, items: [{ description: "白板筆", amount: 500 }, { description: "資料夾", amount: 500 }] }) as any;
    expect(fixed.items.map((i: any) => i.amount)).toEqual([525, 525]);
    const odd = reconcileReimbursementItems({ totalAmount: 105, taxAmount: 5, items: [{ description: "a", amount: 33 }, { description: "b", amount: 33 }, { description: "c", amount: 34 }] }) as any;
    expect(Math.round(odd.items.reduce((s: number, i: any) => s + i.amount, 0) * 100)).toBe(10500);
  });
  it("本來就對得上、或差額不是稅額時不動，交給 ERP 檢查", async () => {
    const { reconcileReimbursementItems } = await import("../ai-agent");
    const ok = { totalAmount: 1050, taxAmount: 50, items: [{ description: "文具", amount: 1050 }] };
    expect(reconcileReimbursementItems(ok)).toBe(ok);
    const wrong = { totalAmount: 1050, taxAmount: 50, items: [{ description: "文具", amount: 900 }] };
    expect(reconcileReimbursementItems(wrong)).toBe(wrong);
    const noTax = { totalAmount: 1050, items: [{ description: "文具", amount: 1000 }] };
    expect(reconcileReimbursementItems(noTax)).toBe(noTax);
  });
});
