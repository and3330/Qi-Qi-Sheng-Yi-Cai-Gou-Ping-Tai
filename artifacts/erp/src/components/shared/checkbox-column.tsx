import { CheckSquare, Square } from "lucide-react";

interface CheckboxColumnProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}

export function CheckboxCell({ checked, onChange }: CheckboxColumnProps) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }} className="flex items-center justify-center w-full">
      {checked
        ? <CheckSquare size={16} className="text-primary" />
        : <Square size={16} className="text-muted-foreground" />
      }
    </button>
  );
}

export function CheckboxHeader({ checked, indeterminate, onChange }: CheckboxColumnProps) {
  return (
    <button onClick={onChange} className="flex items-center justify-center w-full">
      {checked
        ? <CheckSquare size={16} className="text-primary" />
        : indeterminate
          ? <div className="relative"><Square size={16} /><div className="absolute inset-0 flex items-center justify-center"><div className="w-2 h-2 bg-primary rounded-sm" /></div></div>
          : <Square size={16} className="text-muted-foreground" />
      }
    </button>
  );
}
