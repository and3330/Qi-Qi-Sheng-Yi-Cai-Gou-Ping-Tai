import assert from "node:assert/strict";
import test from "node:test";
import { diffText } from "./textDiff.ts";

test("中文無空白內容只標示實際變更的字", () => {
  assert.deepEqual(
    diffText("每日補充維生素C有助健康", "每日補充維生素D有助健康"),
    [
      { value: "每日補充維生素", kind: "same" },
      { value: "C", kind: "removed" },
      { value: "D", kind: "added" },
      { value: "有助健康", kind: "same" },
    ],
  );
});

test("中文新增內容保留前後未變段落", () => {
  assert.deepEqual(
    diffText("使用前請詳閱說明", "使用前請務必詳閱說明"),
    [
      { value: "使用前請", kind: "same" },
      { value: "務必", kind: "added" },
      { value: "詳閱說明", kind: "same" },
    ],
  );
});

test("長文先排除共同前後文後仍能精準比較", () => {
  const prefix = "相同內容".repeat(2_000);
  const suffix = "注意事項".repeat(2_000);
  const result = diffText(`${prefix}甲${suffix}`, `${prefix}乙${suffix}`);

  assert.deepEqual(result.slice(1, 3), [
    { value: "甲", kind: "removed" },
    { value: "乙", kind: "added" },
  ]);
  assert.equal(result[0].value, prefix);
  assert.equal(result.at(-1)?.value, suffix);
});