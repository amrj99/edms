import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecipientUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  organizationName?: string;
  role?: string;
}

// ── Shared chip style ──────────────────────────────────────────────────────────
const chipCls = "inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium shrink-0";

// ── Shared bordered-box style (chips + inline input together) ─────────────────
const boxCls = [
  "flex flex-wrap gap-1 min-h-9 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm",
  "ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
  "cursor-text",
].join(" ");

// ── Dropdown list shared style ─────────────────────────────────────────────────
function UserDropdown({ filtered, selectedIds, onToggle }: {
  filtered: RecipientUser[];
  selectedIds: number[];
  onToggle: (u: RecipientUser) => void;
}) {
  if (filtered.length === 0) return (
    <div className="p-3 text-sm text-muted-foreground text-center">No users found</div>
  );
  return (
    <div className="max-h-52 overflow-y-auto">
      {filtered.map(u => {
        const isSelected = selectedIds.includes(u.id);
        return (
          <button
            key={u.id}
            type="button"
            onMouseDown={e => { e.preventDefault(); onToggle(u); }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/70 transition-colors",
              isSelected && "bg-primary/5"
            )}
          >
            <div className={cn(
              "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
              isSelected ? "bg-primary text-white" : "bg-muted text-muted-foreground"
            )}>
              {isSelected
                ? <Check className="h-3.5 w-3.5" />
                : `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? u.email?.[0] ?? "?"}`
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate leading-none">{u.firstName} {u.lastName}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {u.email}
                {u.organizationName && (
                  <span className="ml-1.5 text-[10px] bg-muted px-1 py-0.5 rounded">{u.organizationName}</span>
                )}
              </p>
            </div>
            {u.role && (
              <span className="text-[10px] text-muted-foreground capitalize shrink-0 bg-muted/60 px-1.5 py-0.5 rounded">
                {u.role.replace(/_/g, " ")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── RecipientAutocomplete (TO field — user-ID based, chips-in-box) ────────────
interface RecipientAutocompleteProps {
  users: RecipientUser[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  single?: boolean;
}

export function RecipientAutocomplete({
  users,
  selectedIds,
  onChange,
  placeholder = "Search by name or email…",
  className,
  disabled,
  single = false,
}: RecipientAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lq = query.toLowerCase();
  const filtered = lq.length >= 1
    ? users.filter(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(lq) ||
        u.email.toLowerCase().includes(lq) ||
        u.organizationName?.toLowerCase().includes(lq)
      ).slice(0, 10)
    : users.filter(u => !selectedIds.includes(u.id)).slice(0, 8);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = useCallback((u: RecipientUser) => {
    const uid = u.id;
    if (single) {
      onChange(selectedIds.includes(uid) ? [] : [uid]);
      setOpen(false);
      setQuery("");
    } else {
      onChange(selectedIds.includes(uid)
        ? selectedIds.filter(id => id !== uid)
        : [...selectedIds, uid]);
      setQuery("");
    }
  }, [selectedIds, onChange, single]);

  const remove = (uid: number) => onChange(selectedIds.filter(id => id !== uid));
  const selectedUsers = users.filter(u => selectedIds.includes(u.id));

  // Single-select mode: keep original simpler display
  if (single) {
    const selectedUser = selectedUsers[0];
    return (
      <div ref={containerRef} className={cn("relative", className)}>
        {selectedUser && !open ? (
          <div className="flex items-center justify-between bg-muted/50 border rounded-md px-3 py-1.5 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{selectedUser.firstName} {selectedUser.lastName}</span>
              {selectedUser.organizationName && (
                <span className="text-xs text-muted-foreground truncate">· {selectedUser.organizationName}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { onChange([]); setTimeout(() => inputRef.current?.focus(), 50); }}
              className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
              disabled={disabled}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
                "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            />
          </div>
        )}
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg overflow-hidden">
            <UserDropdown filtered={filtered} selectedIds={selectedIds} onToggle={toggle} />
          </div>
        )}
      </div>
    );
  }

  // Multi-select: chips + inline input in one bordered box
  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(boxCls, disabled && "opacity-50 pointer-events-none")}
        onClick={() => inputRef.current?.focus()}
      >
        {selectedUsers.map(u => (
          <span key={u.id} className={chipCls}>
            {u.firstName} {u.lastName}
            {u.organizationName && (
              <span className="text-primary/60 text-[10px]">({u.organizationName})</span>
            )}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); remove(u.id); }}
              className="hover:text-destructive ml-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === "Backspace" && !query && selectedIds.length > 0) {
              remove(selectedIds[selectedIds.length - 1]);
            }
          }}
          placeholder={selectedUsers.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg overflow-hidden">
          <UserDropdown filtered={filtered} selectedIds={selectedIds} onToggle={toggle} />
        </div>
      )}
    </div>
  );
}

// ── EmailChipInput (CC / BCC — free-form email, same visual as above) ─────────
interface EmailChipInputProps {
  users: RecipientUser[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function EmailChipInput({
  users,
  value,
  onChange,
  placeholder = "Add email…",
  className,
  disabled,
}: EmailChipInputProps) {
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = value.split(",").map(e => e.trim()).filter(Boolean);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Commit any pending partial email on blur
        if (inputVal.trim()) {
          commitInput(inputVal);
        }
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [inputVal]);

  const commitInput = (raw: string) => {
    const trimmed = raw.replace(/[,\s]+$/, "").trim();
    if (!trimmed) return;
    if (!chips.includes(trimmed)) {
      onChange([...chips, trimmed].join(", "));
    }
    setInputVal("");
    setOpen(false);
  };

  const removeChip = (email: string) => {
    onChange(chips.filter(c => c !== email).join(", "));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "," || e.key === "Enter" || e.key === "Tab") && inputVal.trim()) {
      e.preventDefault();
      commitInput(inputVal);
    } else if (e.key === "Backspace" && !inputVal && chips.length > 0) {
      removeChip(chips[chips.length - 1]);
    }
  };

  const lq = inputVal.toLowerCase();
  const suggestions = lq.length >= 1
    ? users.filter(u =>
        !chips.includes(u.email) &&
        (`${u.firstName} ${u.lastName}`.toLowerCase().includes(lq) ||
          u.email.toLowerCase().includes(lq))
      ).slice(0, 6)
    : open
      ? users.filter(u => !chips.includes(u.email)).slice(0, 6)
      : [];

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(boxCls, disabled && "opacity-50 pointer-events-none")}
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map(email => (
          <span key={email} className={chipCls}>
            {email}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); removeChip(email); }}
              className="hover:text-destructive ml-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={chips.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-40 overflow-y-auto">
            {suggestions.map(u => (
              <button
                key={u.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); commitInput(u.email); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/70 transition-colors"
              >
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                  {u.firstName?.[0] ?? ""}{u.lastName?.[0] ?? u.email?.[0] ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate leading-none">{u.firstName} {u.lastName}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Keep CCAutocomplete as alias for backward compat (other files may import it)
export { EmailChipInput as CCAutocomplete };
