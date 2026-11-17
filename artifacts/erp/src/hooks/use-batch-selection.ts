import { useState, useCallback, useMemo } from "react";

export function useBatchSelection<T extends { id: number | string }>(data: T[] | undefined) {
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(new Set());

  const toggle = useCallback((id: number | string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!data || data.length === 0) return;
    setSelectedIds(prev => {
      if (prev.size === data.length) return new Set();
      return new Set(data.map(d => d.id));
    });
  }, [data]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const allSelected = useMemo(() => {
    return !!data && data.length > 0 && selectedIds.size === data.length;
  }, [data, selectedIds.size]);

  const someSelected = useMemo(() => {
    return selectedIds.size > 0 && !allSelected;
  }, [selectedIds.size, allSelected]);

  return {
    selectedIds,
    toggle,
    toggleAll,
    clearSelection,
    allSelected,
    someSelected,
    count: selectedIds.size,
    ids: useMemo(() => Array.from(selectedIds), [selectedIds]),
  };
}
