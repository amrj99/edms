import { useState, useCallback } from "react";

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible?: boolean;
}

export function useColumnVisibility(tableId: string, columns: ColumnDef[]) {
  const storageKey = `col-vis:${tableId}`;

  const getDefaults = (): Record<string, boolean> =>
    Object.fromEntries(columns.map(c => [c.key, c.defaultVisible ?? true]));

  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>;
        return { ...getDefaults(), ...parsed };
      }
    } catch {}
    return getDefaults();
  });

  const isVisible = useCallback(
    (key: string) => visibility[key] !== false,
    [visibility],
  );

  const toggle = useCallback(
    (key: string) => {
      setVisibility(prev => {
        const next = { ...prev, [key]: !prev[key] };
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
        return next;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    const defaults = getDefaults();
    setVisibility(defaults);
    try { localStorage.removeItem(storageKey); } catch {}
  }, [storageKey]);

  const visibleCount = columns.filter(c => isVisible(c.key)).length;

  return { isVisible, toggle, reset, columns, visibleCount };
}
