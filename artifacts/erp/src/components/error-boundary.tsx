import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

const RELOAD_FLAG = "chunk_reload_at";

/** 判斷是否為「發布新版後瀏覽器還拿舊檔案」造成的載入失敗 */
function isChunkLoadError(error: Error): boolean {
  const msg = String(error?.message || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

/**
 * 全域錯誤防護罩：
 * 1. 頁面載入失敗（多半是發布新版後的暫時現象）→ 自動重新載入一次
 * 2. 其他錯誤 → 顯示中文說明與「重新整理」按鈕，不再整頁白屏
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
      // 60 秒內只自動重載一次，避免無限重載
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.error) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-xl font-semibold">
              {chunkError ? "系統已更新，請重新整理" : "頁面載入發生問題"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {chunkError
                ? "系統剛發布了新版本，需要重新載入才能繼續使用。"
                : "很抱歉，這個頁面發生錯誤。請重新整理後再試一次；若持續發生，請聯絡系統管理員。"}
            </p>
            {!chunkError && (
              <p className="text-xs text-muted-foreground break-all">{String(this.state.error.message || this.state.error)}</p>
            )}
            <button
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
              onClick={() => window.location.reload()}
            >
              重新整理
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
