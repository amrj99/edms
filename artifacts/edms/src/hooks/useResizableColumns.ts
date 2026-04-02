import { useState, useCallback, useEffect, useRef } from "react";

export interface ColDef {
  key: string;
  defaultWidth: number;
  minWidth?: number;
}

export function useResizableColumns(storageKey: string, cols: ColDef[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem(`col-widths-${storageKey}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults in case columns changed
        const defaults = Object.fromEntries(cols.map(c => [c.key, c.defaultWidth]));
        return { ...defaults, ...parsed };
      }
    } catch {}
    return Object.fromEntries(cols.map(c => [c.key, c.defaultWidth]));
  });

  const dragInfo = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  // Persist widths to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(`col-widths-${storageKey}`, JSON.stringify(widths));
    } catch {}
  }, [widths, storageKey]);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const col = cols.find(c => c.key === key);
    dragInfo.current = {
      key,
      startX: e.clientX,
      startWidth: widths[key] ?? col?.defaultWidth ?? 100,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragInfo.current) return;
      const dx = ev.clientX - dragInfo.current.startX;
      const minW = cols.find(c => c.key === dragInfo.current!.key)?.minWidth ?? 50;
      const newW = Math.max(minW, dragInfo.current.startWidth + dx);
      setWidths(prev => ({ ...prev, [dragInfo.current!.key]: newW }));
    };

    const onUp = () => {
      dragInfo.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [widths, cols]);

  const resetWidths = useCallback(() => {
    const defaults = Object.fromEntries(cols.map(c => [c.key, c.defaultWidth]));
    setWidths(defaults);
    try { localStorage.removeItem(`col-widths-${storageKey}`); } catch {}
  }, [cols, storageKey]);

  const getThStyle = (key: string): React.CSSProperties => ({
    width: widths[key] ?? cols.find(c => c.key === key)?.defaultWidth,
    minWidth: cols.find(c => c.key === key)?.minWidth ?? 50,
    position: "relative" as const,
    overflow: "hidden",
  });

  return { widths, getThStyle, startResize, resetWidths };
}
