import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface PrintButtonProps {
  title: string;
  contentId?: string;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function PrintButton({ title, contentId, className, variant = "outline", size = "sm" }: PrintButtonProps) {
  const handlePrint = () => {
    const content = contentId ? document.getElementById(contentId) : null;
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    const html = content ? content.innerHTML : document.querySelector("main")?.innerHTML || "";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif; padding: 20px; color: #333; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
          th { background: #f5f5f5; font-weight: 600; }
          h1, h2, h3 { margin: 10px 0; }
          .company-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .company-header h1 { font-size: 18px; margin: 0; }
          .company-header p { margin: 4px 0; font-size: 12px; color: #666; }
          .print-title { font-size: 16px; font-weight: bold; margin: 15px 0 10px; }
          .print-date { font-size: 11px; color: #999; text-align: right; }
          @media print { button, .no-print { display: none !important; } }
        </style>
      </head>
      <body>
        <div class="company-header">
          <h1>七期生醫</h1>
          <p>Yu-Bang Cultural Education Technology Co., Ltd.</p>
        </div>
        <div class="print-title">${title}</div>
        <div class="print-date">列印日期：${new Date().toLocaleDateString("zh-TW")}</div>
        ${html}
        <script>window.print(); window.onafterprint = function() { window.close(); };</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Button variant={variant} size={size} onClick={handlePrint} className={className}>
      <Printer className="mr-1 h-4 w-4" />列印
    </Button>
  );
}
