import { useCallback, useState } from "react";

/** 淺色／深色外觀。選擇記在這台裝置上；沒選過就用淺色。 */
const STORAGE_KEY = "theme";

/** 畫面出現前先套用上次的選擇，避免先閃一下淺色 */
export function applyStoredTheme(): void {
  try {
    document.documentElement.classList.toggle("dark", localStorage.getItem(STORAGE_KEY) === "dark");
  } catch {
    // 讀不到儲存空間就維持淺色
  }
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem(STORAGE_KEY, next ? "dark" : "light"); } catch { /* 記不住也照樣切換 */ }
    setDark(next);
  }, []);
  return { dark, toggle };
}
