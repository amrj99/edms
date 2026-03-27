import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Check, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface RecipientUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  organizationName?: string;
  role?: string;
}

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
    : users.slice(0, 8);

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

  const toggle = useCallback((uid: number) => {
    if (single) {
      onChange(selectedIds.includes(uid) ? [] : [uid]);
      setOpen(false);
      setQuery("");
    } else {
      onChange(selectedIds.includes(uid)
        ? selectedIds.filter(id => id !== uid)
        : [...selectedIds, uid]);
    }
  }, [selectedIds, onChange, single]);

  const remove = (uid: number) => onChange(selectedIds.filter(id => id !== uid));

  const selectedUsers = users.filter(u => selectedIds.includes(u.id));

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Selected chips */}
      {!single && selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selectedUsers.map(u => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium"
            >
              {u.firstName} {u.lastName}
              {u.organizationName && (
                <span className="text-primary/60 text-[10px]">({u.organizationName})</span>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(u.id); }}
                className="hover:text-destructive ml-0.5"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Single-select display */}
      {single && selectedUsers[0] && !open && (
        <div className="flex items-center justify-between bg-muted/50 border rounded-md px-3 py-1.5 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{selectedUsers[0].firstName} {selectedUsers[0].lastName}</span>
            {selectedUsers[0].organizationName && (
              <span className="text-xs text-muted-foreground truncate">· {selectedUsers[0].organizationName}</span>
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
      )}

      {/* Input: shown when empty (single mode) or always (multi mode) */}
      {(!single || selectedUsers.length === 0 || open) && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className="pl-8 h-9 text-sm"
          />
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground text-center">
              {query ? `No users match "${query}"` : "No users available"}
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {filtered.map(u => {
                const isSelected = selectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
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
                        : `${u.firstName[0]}${u.lastName[0]}`
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-none">
                        {u.firstName} {u.lastName}
                      </p>
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
          )}
        </div>
      )}
    </div>
  );
}

interface CCAutocompleteProps {
  users: RecipientUser[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export function CCAutocomplete({ users, value, onChange, placeholder = "cc@example.com, …", className }: CCAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const currentEmails = value.split(",").map(e => e.trim()).filter(Boolean);
  const lq = query.toLowerCase();
  const suggestions = query.length >= 1
    ? users.filter(u =>
        !currentEmails.includes(u.email) &&
        (`${u.firstName} ${u.lastName}`.toLowerCase().includes(lq) || u.email.toLowerCase().includes(lq))
      ).slice(0, 6)
    : [];

  const pickUser = (u: RecipientUser) => {
    const next = [...currentEmails, u.email].join(", ");
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  const handleInputChange = (v: string) => {
    setQuery(v);
    const commaIdx = v.lastIndexOf(",");
    const lastPart = commaIdx >= 0 ? v.slice(commaIdx + 1).trim() : v.trim();
    if (lastPart) setOpen(true);
    else setOpen(false);

    if (v.endsWith(",") || v.endsWith(" ")) {
      const parts = v.split(",").map(s => s.trim()).filter(Boolean);
      onChange(parts.join(", "));
      setQuery("");
    } else {
      onChange(v);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        value={query || value}
        onChange={e => handleInputChange(e.target.value)}
        onFocus={() => { if (query) setOpen(true); }}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-lg shadow-lg overflow-hidden">
          {suggestions.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => pickUser(u)}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/70 transition-colors"
            >
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                {u.firstName[0]}{u.lastName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.firstName} {u.lastName}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}
                  {u.organizationName && <span className="ml-1.5 text-[10px] bg-muted px-1 py-0.5 rounded">{u.organizationName}</span>}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
