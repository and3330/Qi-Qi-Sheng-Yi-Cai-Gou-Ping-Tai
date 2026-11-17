import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const THRESHOLD = 70; // 下拉超過此距離(px)放開即觸發更新
const MAX_PULL = 110;

/**
 * 手機版全域下拉更新:
 * - 頁面若有使用 react-query 的資料,重新抓取當前畫面上的查詢
 * - 否則整頁重新載入,確保任何頁面都能更新
 */
export function usePullToRefresh(scrollRef: React.RefObject<HTMLElement | null>) {
  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const distRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 只在觸控裝置 + 手機寬度啟用
    const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

    const setDist = (d: number) => {
      distRef.current = d;
      setPullDistance(d);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || refreshingRef.current) return;
      if (el.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
        pulling.current = false;
      } else {
        startY.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pulling.current) setDist(0);
        pulling.current = false;
        return;
      }
      pulling.current = true;
      if (e.cancelable) e.preventDefault(); // 阻止瀏覽器原生 overscroll
      // 阻尼效果
      const damped = Math.min(MAX_PULL, dy * 0.5);
      setDist(damped);
    };

    const doRefresh = async () => {
      refreshingRef.current = true;
      setRefreshing(true);
      setDist(56); // 固定顯示轉圈
      const active = queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.getObserversCount() > 0);
      try {
        if (active.length > 0) {
          await queryClient.refetchQueries({ type: "active" });
          // 給使用者看得到轉圈的最短時間
          await new Promise((r) => setTimeout(r, 300));
          refreshingRef.current = false;
          setRefreshing(false);
          setDist(0);
        } else {
          // 沒有可重抓的查詢(手動 fetch 的頁面)→ 整頁重新載入
          window.location.reload();
        }
      } catch {
        refreshingRef.current = false;
        setRefreshing(false);
        setDist(0);
      }
    };

    const onTouchEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (!pulling.current) return;
      pulling.current = false;
      // damped 距離為實際拉動的一半,換算回來判斷是否超過門檻
      if (distRef.current * 2 >= THRESHOLD) {
        doRefresh();
        return;
      }
      setDist(0);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollRef, queryClient]);

  return { pullDistance, refreshing, triggered: pullDistance * 2 >= THRESHOLD };
}
