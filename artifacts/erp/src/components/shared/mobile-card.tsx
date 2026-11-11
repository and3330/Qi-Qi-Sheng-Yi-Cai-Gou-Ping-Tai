import React from "react";
import { cn } from "@/lib/utils";

export function MobileCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("bg-white border rounded-lg p-4 mb-3 shadow-sm md:hidden", className)}>{children}</div>;
}

export function MobileCardHeader({ title, value, titleClass, valueClass }: { title: React.ReactNode, value?: React.ReactNode, titleClass?: string, valueClass?: string }) {
  return (
    <div className="flex justify-between items-start mb-3 pb-2 border-b">
      <div className={cn("font-medium text-base", titleClass)}>{title}</div>
      {value && <div className={cn("font-bold text-lg", valueClass)}>{value}</div>}
    </div>
  );
}

export function MobileCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">{children}</div>;
}

export function MobileCardItem({ label, value, className, valueClass, right }: { label: React.ReactNode, value: React.ReactNode, className?: string, valueClass?: string, right?: boolean }) {
  return (
    <div className={cn("flex flex-col", right && "items-end text-right", className)}>
      <span className="text-gray-500 text-xs mb-0.5">{label}</span>
      <span className={cn("font-medium", valueClass)}>{value}</span>
    </div>
  );
}

export function MobileTotalCard({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={cn("bg-gray-100 border-2 rounded-lg p-4 mt-2 shadow-sm md:hidden", className)}>{children}</div>;
}
