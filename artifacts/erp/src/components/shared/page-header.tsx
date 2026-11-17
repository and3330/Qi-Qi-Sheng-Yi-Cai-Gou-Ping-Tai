import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import { navTitleForPath } from "@/components/layout/sidebar";

interface PageHeaderProps {
  title: string;
  description?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, hint, action, onAdd, addLabel, children }: PageHeaderProps) {
  const [location] = useLocation();
  const shownInTitleBar = !!navTitleForPath(location);
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={`text-xl md:text-2xl font-bold text-foreground ${shownInTitleBar ? "max-md:sr-only" : ""}`}>{title}</h1>
          {hint}
        </div>
        {description && <p className="text-sm text-muted-foreground md:mt-1">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {action}
        {onAdd && (
          <Button onClick={onAdd} size="sm" data-perm="create">
            <Plus size={16} className="mr-1" />
            {addLabel || "新增"}
          </Button>
        )}
      </div>
    </div>
  );
}
