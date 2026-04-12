import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnDef } from "@/hooks/useColumnVisibility";

interface Props {
  columns: ColumnDef[];
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  reset: () => void;
  pinnedKeys?: string[];
}

export function ColumnVisibilityMenu({
  columns,
  isVisible,
  toggle,
  reset,
  pinnedKeys = [],
}: Props) {
  const hiddenCount = columns.filter(
    c => !pinnedKeys.includes(c.key) && !isVisible(c.key),
  ).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columns
          {hiddenCount > 0 && (
            <span className="rounded-full bg-primary text-primary-foreground px-1.5 text-[10px] font-semibold leading-4">
              -{hiddenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {columns.map(col => {
          const pinned = pinnedKeys.includes(col.key);
          return (
            <DropdownMenuCheckboxItem
              key={col.key}
              checked={isVisible(col.key)}
              disabled={pinned}
              onCheckedChange={() => {
                if (!pinned) toggle(col.key);
              }}
            >
              {col.label}
              {pinned && (
                <span className="ml-auto text-[10px] text-muted-foreground">always</span>
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={reset}
          className="gap-1.5 text-xs text-muted-foreground justify-center focus:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
