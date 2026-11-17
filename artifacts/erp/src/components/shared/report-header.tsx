import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { navTitleForPath } from "@/components/layout/sidebar";

/**
 * 報表抬頭。
 * 畫面上只顯示一行單位說明；列印時改成正式抬頭（報表名稱、列印時間、製表人）。
 * 放在報表頁最外層（該層要標 data-report，樣式在 index.css）。
 */
export function ReportHeader({ money = true }: { money?: boolean }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const title = navTitleForPath(location) || "報表";
  const maker = (user as { displayName?: string | null; username?: string | null } | null)?.displayName
    || (user as { username?: string | null } | null)?.username
    || "";
  const printedAt = new Date().toLocaleString("zh-TW", { hour12: false });

  return (
    <>
      <div className="report-print-header" aria-hidden>
        <div className="report-print-title">{title}</div>
        <div className="report-print-meta">
          <span>列印時間：{printedAt}</span>
          {maker && <span>製表人：{maker}</span>}
          {money && <span>單位：新台幣元</span>}
        </div>
      </div>
      {money && (
        <p className="report-unit-note" data-testid="text-report-unit">
          單位：新台幣元　負數以（ ）表示
        </p>
      )}
    </>
  );
}
