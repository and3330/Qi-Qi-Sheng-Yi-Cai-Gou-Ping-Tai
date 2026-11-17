import { describe, expect, it } from "vitest";
import { matchChannel, normalizeRef, parsePayoutText, payoutBalanceProblem, payoutInputProblem, planPayout, splitByChannel, type OpenReceivable } from "../payment-channel-rules";

const newebpay = { id: 1, methods: ["newebpay", "藍新"], startDate: "2026-12-01", isActive: true };
const ecpay = { id: 2, methods: ["ecpay"], startDate: "2026-12-01", isActive: true };
const notStarted = { id: 3, methods: ["stripe"], startDate: null, isActive: true };
const disabled = { id: 4, methods: ["airwallex"], startDate: "2026-01-01", isActive: false };
const channels = [newebpay, ecpay, notStarted, disabled];

describe("金流通路：哪些收款要先掛通路欠款", () => {
  it("付款方式對得上、而且在啟用日當天或之後，才掛通路欠款", () => {
    expect(matchChannel(channels, "newebpay", "2026-12-01")?.id).toBe(1);
    expect(matchChannel(channels, " NewebPay ", "2026-12-15T03:00:00Z")?.id).toBe(1);
    expect(matchChannel(channels, "藍新", "2027-01-01")?.id).toBe(1);
    // 啟用日之前的訂單維持原本記法
    expect(matchChannel(channels, "newebpay", "2026-11-30")).toBeNull();
  });

  it("還沒設啟用日、已停用、或不認得的付款方式，都維持原本記法", () => {
    expect(matchChannel(channels, "stripe", "2026-12-15")).toBeNull();
    expect(matchChannel(channels, "airwallex", "2026-12-15")).toBeNull();
    expect(matchChannel(channels, "cash", "2026-12-15")).toBeNull();
    expect(matchChannel(channels, "", "2026-12-15")).toBeNull();
  });

  it("一張訂單用兩種方式付款時各自歸到對的地方", () => {
    const split = splitByChannel(channels, [{ method: "newebpay", amount: 700 }, { method: "ecpay", amount: 200 }, { method: "cash", amount: 100 }, { method: "newebpay", amount: 50 }], "2026-12-05");
    expect(split.byChannel.map(b => [b.channel.id, b.amount])).toEqual([[1, 750], [2, 200]]);
    expect(split.direct).toBe(100);
    expect(splitByChannel(channels, [{ method: "newebpay", amount: 700 }], "2026-11-01")).toEqual({ byChannel: [], direct: 700 });
  });
});

const open: OpenReceivable[] = [
  { id: 1, externalRef: "CM-1001", orderNumber: "CM-LIFE-CM-1001", amount: 1000, projectId: 10, departmentId: null, expectedFee: 28 },
  { id: 2, externalRef: "CM-1002", orderNumber: "CM-LIFE-CM-1002", amount: 2000, projectId: 10, departmentId: null },
  { id: 3, externalRef: "AI-77", orderNumber: "AI-UNIVERSITY-AI-77", amount: 5000, projectId: 20, departmentId: 3 },
  { id: 4, externalRef: "CM-1003", orderNumber: "CM-LIFE-CM-1003", amount: 800, projectId: 10, departmentId: null },
  { id: 5, externalRef: "CM-1003", orderNumber: "CM-LIFE-CM-1003", amount: -800, projectId: 10, departmentId: null },
];

describe("金流通路：撥款明細逐筆沖銷", () => {
  it("逐筆對到欠款，手續費依專案分組，淨額＝欠款−手續費", () => {
    const plan = planPayout(open, [{ ref: "CM-1001", amount: 1000, fee: 28 }, { ref: "cm1002", fee: 56 }, { ref: "AI-77", amount: 5000, fee: 140 }]);
    expect(plan.problems).toEqual([]);
    expect(plan.matched.map(m => m.receivableId)).toEqual([1, 2, 3]);
    expect(plan).toMatchObject({ gross: 8000, fee: 224, net: 7776 });
    expect(plan.feeGroups).toEqual([{ projectId: 10, departmentId: null, fee: 84 }, { projectId: 20, departmentId: 3, fee: 140 }]);
    expect(payoutBalanceProblem(plan, 7776)).toBeNull();
  });

  it("編號比對不分大小寫、不管連字號，也可以用 ERP 的單號", () => {
    expect(normalizeRef(" CM-1001 ")).toBe("cm1001");
    expect(planPayout(open, [{ ref: "cm_life-cm-1001", amount: 1000 }]).matched[0].receivableId).toBe(1);
  });

  it("同一張訂單有收款也有退款時靠金額分辨；退款寫正數或負數都可以", () => {
    expect(planPayout(open, [{ ref: "CM-1003" }]).problems[0].reason).toContain("請在明細填金額");
    const both = planPayout(open, [{ ref: "CM-1003", amount: 800, fee: 22 }, { ref: "CM-1003", amount: -800, fee: -22 }]);
    expect(both.problems).toEqual([]);
    expect(both).toMatchObject({ gross: 0, fee: 0, net: 0 });
    expect(planPayout(open, [{ ref: "CM-1003", amount: 800 }, { ref: "CM-1003", amount: 800 }]).matched.map(m => m.amount)).toEqual([800, -800]);
  });

  it("對不上的每一行都列出原因，不會默默略過", () => {
    const plan = planPayout(open, [{ ref: "CM-9999", amount: 100 }, { ref: "CM-1001", amount: 999 }, { ref: "CM-1002" }, { ref: "CM-1002" }, { ref: "" }, { ref: "AI-77", fee: 5000 }]);
    expect(plan.matched.map(m => m.receivableId)).toEqual([2]);
    expect(plan.problems.map(p => [p.line, p.reason.slice(0, 6)])).toEqual([[1, "找不到這個編"], [2, "金額對不上："], [4, "這個編號在明"], [5, "沒有訂單編號"], [6, "手續費 50"]]);
  });

  it("淨額跟銀行入帳對不上時說清楚差多少；退款比收款多的批次不入帳", () => {
    const plan = planPayout(open, [{ ref: "CM-1001", fee: 28 }, { ref: "CM-1002", fee: 56 }], 15);
    expect(plan).toMatchObject({ gross: 3000, fee: 84, extraFee: 15, net: 2901 });
    expect(payoutBalanceProblem(plan, 2901)).toBeNull();
    expect(payoutBalanceProblem(plan, 2916)).toContain("多了 15");
    expect(payoutBalanceProblem(plan, 2800)).toContain("少了 101");
    expect(payoutBalanceProblem(planPayout(open, [{ ref: "CM-1003", amount: -800 }]), -800)).toContain("不是通路撥款給公司");
    expect(payoutBalanceProblem(planPayout(open, []), 0)).toBe("沒有任何一筆對得上");
  });

  it("入帳前的基本檢查：日期、明細、銀行金額、其他費用要掛專案", () => {
    const base = { payoutDate: "2026-12-05", bankAmount: 972, lines: [{ ref: "CM-1001", fee: 28 }] };
    expect(payoutInputProblem(base)).toBeNull();
    expect(payoutInputProblem({ ...base, payoutDate: "2026-13-05" })).toContain("日期");
    expect(payoutInputProblem({ ...base, lines: [] })).toContain("撥款明細");
    expect(payoutInputProblem({ ...base, bankAmount: NaN })).toContain("銀行實際入帳");
    expect(payoutInputProblem({ ...base, extraFee: { amount: 15, projectId: null } })).toContain("專案");
    expect(payoutInputProblem({ ...base, extraFee: { amount: 15, projectId: 10 } })).toBeNull();
  });
});

describe("金流通路：從貼上的文字讀撥款明細", () => {
  it("逗號、Tab、空白分隔都可以；金額有千分位或幣別符號也讀得懂；標題列略過", () => {
    expect(parsePayoutText('訂單編號,金額,手續費\nCM-1001,"1,000",28\nCM-1002,2000,\n')).toEqual([
      { ref: "CM-1001", amount: 1000, fee: 28 },
      { ref: "CM-1002", amount: 2000, fee: 0 },
    ]);
    const lines = parsePayoutText("訂單編號\t金額\t手續費\nCM-1001\tNT$1,000\t28\nCM-1002\t2000\t56\nAI-77 5000 140\n\nCM-1003\n");
    expect(lines).toEqual([
      { ref: "CM-1001", amount: 1000, fee: 28 },
      { ref: "CM-1002", amount: 2000, fee: 56 },
      { ref: "AI-77", amount: 5000, fee: 140 },
      { ref: "CM-1003", amount: null, fee: 0 },
    ]);
  });
});
