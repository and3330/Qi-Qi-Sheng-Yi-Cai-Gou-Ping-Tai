import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ pool: {} }));

import { createTouchThrottle } from "../session-store";

describe("登入時效延長的節流", () => {
  it("同一個登入在間隔內只寫一次資料庫", () => {
    let now = 1_000_000;
    const throttle = createTouchThrottle(5 * 60_000, () => now);
    expect(throttle.shouldTouch("a")).toBe(true);
    now += 60_000;
    expect(throttle.shouldTouch("a")).toBe(false);
    now += 4 * 60_000;
    expect(throttle.shouldTouch("a")).toBe(true);
  });

  it("不同的登入各自計算", () => {
    const now = 1_000_000;
    const throttle = createTouchThrottle(5 * 60_000, () => now);
    expect(throttle.shouldTouch("a")).toBe(true);
    expect(throttle.shouldTouch("b")).toBe(true);
    expect(throttle.shouldTouch("a")).toBe(false);
  });

  it("登出後重新登入不會被當成剛更新過", () => {
    const now = 1_000_000;
    const throttle = createTouchThrottle(5 * 60_000, () => now);
    expect(throttle.shouldTouch("a")).toBe(true);
    throttle.forget("a");
    expect(throttle.shouldTouch("a")).toBe(true);
  });
});
