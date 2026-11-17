import { describe, expect, it } from "vitest";
import { CUSTOM_DEFAULT_MODELS, LEGACY_MODEL, describeAiProviders, resolveAiProvider, temperatureParam } from "../ai-provider";

const LEGACY = { AI_INTEGRATIONS_OPENAI_BASE_URL: "https://legacy.example/v1/", AI_INTEGRATIONS_OPENAI_API_KEY: "legacy-key" };
const CUSTOM = { AI_PROVIDER_BASE_URL: "https://api.atlascloud.ai/v1/", AI_PROVIDER_API_KEY: "atlas-key" };

describe("AI 供應商設定", () => {
  it("沒設定新供應商時，行為與原本完全相同", () => {
    for (const tier of ["strong", "small", "vision"] as const) {
      expect(resolveAiProvider(tier, LEGACY)).toEqual({ baseUrl: "https://legacy.example/v1", apiKey: "legacy-key", model: LEGACY_MODEL, source: "replit" });
    }
  });

  it("設定新供應商後，三級各用自己的預設模型，位址結尾的斜線會去掉", () => {
    expect(resolveAiProvider("strong", { ...LEGACY, ...CUSTOM })).toEqual({ baseUrl: "https://api.atlascloud.ai/v1", apiKey: "atlas-key", model: CUSTOM_DEFAULT_MODELS.strong, source: "custom" });
    expect(resolveAiProvider("small", CUSTOM).model).toBe(CUSTOM_DEFAULT_MODELS.small);
    expect(resolveAiProvider("vision", CUSTOM).model).toBe(CUSTOM_DEFAULT_MODELS.vision);
  });

  it("可以用環境變數個別指定每一級的模型", () => {
    expect(resolveAiProvider("strong", { ...CUSTOM, AI_MODEL_STRONG: " xai/grok-4.3 " }).model).toBe("xai/grok-4.3");
    expect(resolveAiProvider("small", { ...CUSTOM, AI_MODEL_STRONG: "xai/grok-4.3" }).model).toBe(CUSTOM_DEFAULT_MODELS.small);
  });

  it("位址和金鑰只設一半時不啟用新供應商，也不會把金鑰送到另一家", () => {
    const half = resolveAiProvider("strong", { ...LEGACY, AI_PROVIDER_API_KEY: "atlas-key" });
    expect(half).toMatchObject({ source: "replit", apiKey: "legacy-key", baseUrl: "https://legacy.example/v1" });
    expect(resolveAiProvider("strong", { ...LEGACY, AI_PROVIDER_BASE_URL: "https://api.atlascloud.ai/v1" }).apiKey).toBe("legacy-key");
  });

  it("帶廠商前綴的模型名稱不會被送到原本的整合", () => {
    expect(resolveAiProvider("strong", { ...LEGACY, AI_MODEL_STRONG: "openai/gpt-5.6-luna" }).model).toBe(LEGACY_MODEL);
    expect(resolveAiProvider("strong", { ...LEGACY, AI_MODEL_STRONG: "gpt-other" }).model).toBe("gpt-other");
  });

  it("完全沒設定時標示為未設定", () => {
    expect(resolveAiProvider("small", {})).toMatchObject({ source: "none", baseUrl: "", apiKey: "" });
  });

  it("狀態說明不含金鑰", () => {
    const text = JSON.stringify(describeAiProviders({ ...LEGACY, ...CUSTOM }));
    expect(text).toContain("api.atlascloud.ai");
    expect(text).not.toContain("atlas-key");
    expect(text).not.toContain("legacy-key");
  });
});

describe("溫度參數相容性", () => {
  it("只接受預設溫度的模型不送這個參數（送了整個請求會失敗）", () => {
    expect(temperatureParam("openai/gpt-6-luna", 0)).toEqual({});
    expect(temperatureParam("openai/gpt-5.6-luna", 0.7)).toEqual({});
  });

  it("其他模型照常送出", () => {
    expect(temperatureParam("gpt-5.4-mini", 0)).toEqual({ temperature: 0 });
    expect(temperatureParam("deepseek-ai/deepseek-v4.1-flash", 0.3)).toEqual({ temperature: 0.3 });
  });
});
