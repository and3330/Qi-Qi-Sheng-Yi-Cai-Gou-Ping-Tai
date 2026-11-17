import { isRealDate } from "./cash-accounts";

/**
 * 金流通路的規則（純計算，不碰資料庫）：哪些收款要先掛通路欠款、撥款明細怎麼對到欠款、淨額怎麼核對。
 */
type ChannelRule = { id: number; methods: unknown; startDate: string | null; isActive: boolean };
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** 常用通路的預設值：代號、名稱、外部訂單的付款方式可能寫成哪些字 */
export const CHANNEL_PRESETS: Array<{ code: string; name: string; methods: string[] }> = [
  { code: "newebpay", name: "藍新金流", methods: ["newebpay", "藍新", "spgateway"] },
  { code: "ecpay", name: "綠界科技", methods: ["ecpay", "綠界"] },
  { code: "stripe", name: "Stripe", methods: ["stripe"] },
  { code: "airwallex", name: "Airwallex", methods: ["airwallex"] },
  { code: "hotai", name: "和潤無卡分期", methods: ["hotai", "和潤", "hrfc"] },
  { code: "chailease", name: "中租無卡分期", methods: ["chailease", "中租", "zingala", "銀角零卡"] },
];

export const normalizeMethod = (value: unknown): string => String(value ?? "").trim().toLowerCase();
/** 比對訂單編號用：只留英數、不分大小寫（通路的明細常把連字號拿掉或改大小寫） */
export const normalizeRef = (value: unknown): string => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");

/** 這個付款方式在這一天，是不是要先掛某個通路的欠款（純計算）。通路沒啟用或日期早於啟用日就回 null，維持原本記法 */
export function matchChannel<T extends ChannelRule>(channels: T[], method: unknown, date: string): T | null {
  const wanted = normalizeMethod(method);
  if (!wanted) return null;
  return channels.find(c => c.isActive && !!c.startDate && date.slice(0, 10) >= c.startDate
    && (Array.isArray(c.methods) ? c.methods : []).some(m => normalizeMethod(m) === wanted)) ?? null;
}

/** 把一筆收款（或退款）依付款方式拆成「掛哪個通路多少」與「直接進帳戶多少」（純計算） */
export function splitByChannel<T extends ChannelRule>(channels: T[], payments: Array<{ method: string; amount: number }>, date: string): { byChannel: Array<{ channel: T; amount: number }>; direct: number } {
  const byChannel: Array<{ channel: T; amount: number }> = [];
  let direct = 0;
  for (const payment of payments) {
    const amount = round2(payment.amount);
    if (!(amount > 0)) continue;
    const channel = matchChannel(channels, payment.method, date);
    if (!channel) { direct = round2(direct + amount); continue; }
    const existing = byChannel.find(b => b.channel.id === channel.id);
    if (existing) existing.amount = round2(existing.amount + amount);
    else byChannel.push({ channel, amount });
  }
  return { byChannel, direct };
}

export interface OpenReceivable { id: number; externalRef: string; orderNumber: string | null; amount: number; projectId: number | null; departmentId: number | null; expectedFee?: number | null }
export interface PayoutLineInput { ref: string; amount?: number | null; fee?: number | null }
export interface PayoutMatch { receivableId: number; ref: string; orderNumber: string | null; amount: number; fee: number; expectedFee: number | null; projectId: number | null; departmentId: number | null }
export interface PayoutPlan {
  matched: PayoutMatch[];
  problems: Array<{ line: number; ref: string; reason: string }>;
  gross: number; fee: number; extraFee: number; net: number;
  /** 手續費依專案、部門分組（每一組開一張分錄，費用才會掛在對的專案） */
  feeGroups: Array<{ projectId: number | null; departmentId: number | null; fee: number }>;
}

/**
 * 把撥款明細對到還沒撥款的欠款（純計算）。
 * 每一行用訂單編號找；同一個編號有好幾筆沒撥（例如訂單和它的退款）時要靠金額分辨。
 * 任何一行對不上都列在 problems，由呼叫端決定要不要擋下來。
 */
export function planPayout(open: OpenReceivable[], lines: PayoutLineInput[], extraFee = 0): PayoutPlan {
  const used = new Set<number>();
  const matched: PayoutMatch[] = [];
  const problems: PayoutPlan["problems"] = [];
  lines.forEach((line, index): void => {
    const ref = String(line.ref ?? "").trim();
    const key = normalizeRef(ref);
    const report = (reason: string): void => { problems.push({ line: index + 1, ref, reason }); };
    if (!key) return report("沒有訂單編號");
    const candidates = open.filter(r => !used.has(r.id) && (normalizeRef(r.externalRef) === key || (r.orderNumber && normalizeRef(r.orderNumber) === key)));
    if (candidates.length === 0) {
      return report(open.some(r => used.has(r.id) && (normalizeRef(r.externalRef) === key || (r.orderNumber && normalizeRef(r.orderNumber) === key)))
        ? "這個編號在明細裡重複出現" : "找不到這個編號還沒撥款的欠款（可能訂單還沒進 ERP、已經沖過，或不是這個通路的）");
    }
    const hasAmount = line.amount !== undefined && line.amount !== null && String(line.amount) !== "";
    const amount = hasAmount ? round2(Number(line.amount)) : null;
    if (hasAmount && !Number.isFinite(amount)) return report("金額不是數字");
    let target = candidates[0];
    if (amount !== null) {
      // 退款在通路明細裡有的寫正數、有的寫負數，兩種都接受
      const byAmount = candidates.find(r => r.amount === amount) ?? candidates.find(r => r.amount < 0 && r.amount === -amount);
      if (!byAmount) return report(`金額對不上：明細是 ${amount}，帳上是 ${candidates.map(r => r.amount).join("、")}`);
      target = byAmount;
    } else if (candidates.length > 1) {
      return report(`這個編號有 ${candidates.length} 筆還沒撥款（${candidates.map(r => r.amount).join("、")}），請在明細填金額來分辨`);
    }
    const fee = round2(Number(line.fee ?? 0));
    if (!Number.isFinite(fee)) return report("手續費不是數字");
    if (Math.abs(fee) >= Math.abs(target.amount) && fee !== 0) return report(`手續費 ${fee} 不能大於或等於這筆金額 ${target.amount}`);
    if (target.amount > 0 && fee < 0) return report("收款的手續費不能是負數");
    used.add(target.id);
    matched.push({ receivableId: target.id, ref, orderNumber: target.orderNumber, amount: target.amount, fee, expectedFee: target.expectedFee ?? null, projectId: target.projectId, departmentId: target.departmentId });
  });
  const gross = round2(matched.reduce((sum, m) => sum + m.amount, 0));
  const fee = round2(matched.reduce((sum, m) => sum + m.fee, 0));
  const extra = round2(extraFee);
  const groups = new Map<string, { projectId: number | null; departmentId: number | null; fee: number }>();
  for (const m of matched) {
    if (m.fee === 0) continue;
    const key = `${m.projectId ?? ""}|${m.departmentId ?? ""}`;
    const group = groups.get(key) ?? { projectId: m.projectId, departmentId: m.departmentId, fee: 0 };
    group.fee = round2(group.fee + m.fee);
    groups.set(key, group);
  }
  return { matched, problems, gross, fee, extraFee: extra, net: round2(gross - fee - extra), feeGroups: [...groups.values()].filter(g => g.fee !== 0) };
}

/** 從貼上的文字讀撥款明細：每行「訂單編號、金額、手續費」，用逗號、Tab 或空白分隔；金額與手續費可以省略（純計算） */
export function parsePayoutText(text: string): PayoutLineInput[] {
  const number = (value: string | undefined): number | null => {
    if (value === undefined) return null;
    const cleaned = value.replace(/[,，\s$＄]|NT\$?|TWD/gi, "");
    if (cleaned === "" || cleaned === "-") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const lines: PayoutLineInput[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    // 逗號分隔時，引號裡的逗號是千分位（"1,000"），不能拿來切欄位
    const cells = (row.includes("\t") ? row.split("\t") : row.includes(",") ? (row.match(/("[^"]*"|[^,]*)(,|$)/g) ?? []).map(c => c.replace(/,$/, "")).slice(0, -1) : row.split(/\s+/))
      .map(c => c.trim().replace(/^"(.*)"$/, "$1").trim());
    const ref = cells[0];
    // 標題列（第二欄不是數字）略過
    if (cells.length > 1 && cells[1] !== "" && Number.isNaN(number(cells[1]))) continue;
    if (!ref) continue;
    lines.push({ ref, amount: number(cells[1]), fee: number(cells[2]) ?? 0 });
  }
  return lines;
}

export interface PayoutInput {
  payoutDate: string; bankAmount: number; bankAccountId?: number | null; reference?: string | null; note?: string | null;
  lines: PayoutLineInput[];
  /** 不屬於任何一張訂單的費用（例如撥款手續費、月費）；是費用就要掛專案 */
  extraFee?: { amount: number; projectId: number | null; departmentId?: number | null; note?: string | null } | null;
}

export function payoutInputProblem(input: PayoutInput): string | null {
  if (!isRealDate(input.payoutDate)) return "請填撥款進銀行的日期";
  if (!Array.isArray(input.lines) || input.lines.length === 0) return "請貼上撥款明細（至少一筆）";
  if (input.lines.length > 5000) return "一次最多沖 5,000 筆，請分批";
  if (!Number.isFinite(Number(input.bankAmount))) return "請填銀行實際入帳的金額";
  const extra = round2(Number(input.extraFee?.amount ?? 0));
  if (!Number.isFinite(extra) || extra < 0) return "其他費用不能是負數";
  if (extra > 0 && !input.extraFee?.projectId) return "其他費用是公司的支出，請選它要掛在哪個專案";
  return null;
}

/** 核對淨額與銀行入帳金額（純計算）：對不上回傳說明，對得上回傳 null */
export function payoutBalanceProblem(plan: PayoutPlan, bankAmount: number): string | null {
  const bank = round2(bankAmount);
  if (plan.matched.length === 0) return "沒有任何一筆對得上";
  if (!(plan.net > 0)) return `這批沖完的淨額是 ${plan.net}，不是通路撥款給公司（退款比收款多的情況請個別處理）`;
  if (plan.net !== bank) {
    const diff = round2(bank - plan.net);
    return `對不上：明細算出來應該入帳 ${plan.net}（欠款 ${plan.gross} − 手續費 ${plan.fee}${plan.extraFee > 0 ? ` − 其他費用 ${plan.extraFee}` : ""}），銀行實際入帳 ${bank}，${diff > 0 ? "多" : "少"}了 ${Math.abs(diff)}。請檢查是不是漏了訂單、手續費，或有其他扣款`;
  }
  return null;
}

