import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText, File } from "lucide-react";
import { exportCSV, exportExcel, exportPDF, type ExportOptions } from "@/lib/export-utils";

interface ExportMenuProps {
  getExportOptions: () => ExportOptions | Promise<ExportOptions>;
  disabled?: boolean;
}

export function ExportMenu({ getExportOptions, disabled }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleExport = async (format: "csv" | "excel" | "pdf") => {
    try {
      const opts = await getExportOptions();
      if (format === "csv") exportCSV(opts);
      else if (format === "excel") await exportExcel(opts);
      else await exportPDF(opts);
    } catch (e) {
      console.error("Export failed:", e);
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" onClick={() => setOpen(!open)} disabled={disabled} className="shrink-0">
        <Download className="h-4 w-4 mr-1" />匯出
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-50 min-w-[160px] py-1">
          <button
            onClick={() => handleExport("csv")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="h-4 w-4 text-green-600" />
            CSV 匯出
          </button>
          <button
            onClick={() => handleExport("excel")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Excel 匯出
          </button>
          <button
            onClick={() => handleExport("pdf")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <File className="h-4 w-4 text-red-600" />
            PDF 匯出
          </button>
        </div>
      )}
    </div>
  );
}
