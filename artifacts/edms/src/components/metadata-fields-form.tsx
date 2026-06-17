import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface MetadataField {
  id: number;
  name: string;
  label: string;
  fieldType: "text" | "number" | "date" | "select" | "multiselect" | "boolean";
  options: string[] | null;
  required: boolean;
  documentTypeId: number | null;
}

interface MetadataFieldsFormProps {
  /** Resolved document_types.id for the document being created/edited. */
  documentTypeId?: number | null;
  /** Current metadata values, keyed by field name. */
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  /** Called once the resolved fields are known, e.g. to drive validation. */
  onFieldsLoaded?: (fields: MetadataField[]) => void;
}

export function useResolvedMetadataFields(documentTypeId?: number | null) {
  return useQuery<{ fields: MetadataField[] }>({
    queryKey: ["metadata-fields", documentTypeId],
    queryFn: async () => {
      const r = await fetch(`/api/metadata-fields?documentTypeId=${documentTypeId}`, { credentials: "include" });
      return r.ok ? r.json() : { fields: [] };
    },
    enabled: documentTypeId != null,
  });
}

function formatReadOnlyValue(field: MetadataField, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (field.fieldType === "boolean") return raw ? "Yes" : "No";
  if (field.fieldType === "multiselect") return Array.isArray(raw) ? raw.join(", ") || "—" : String(raw);
  return String(raw);
}

export function MetadataFieldsForm({ documentTypeId, value, onChange, readOnly, disabled, className }: MetadataFieldsFormProps) {
  const { data } = useResolvedMetadataFields(documentTypeId);
  const fields = data?.fields ?? [];

  if (fields.length === 0) return null;

  const setField = (name: string, v: unknown) => {
    onChange({ ...value, [name]: v });
  };

  return (
    <div className={cn("grid grid-cols-2 gap-2.5", className)}>
      {fields.map((field) => {
        const current = value[field.name];
        const isWide = field.fieldType === "multiselect";

        if (readOnly) {
          return (
            <div key={field.id} className={isWide ? "col-span-2" : undefined}>
              <Label className="text-xs font-medium text-muted-foreground">{field.label}</Label>
              <p className="text-sm mt-1">{formatReadOnlyValue(field, current)}</p>
            </div>
          );
        }

        return (
          <div key={field.id} className={isWide ? "col-span-2" : undefined}>
            <Label className="text-xs font-medium">
              {field.label}{field.required && <span className="text-destructive"> *</span>}
            </Label>

            {field.fieldType === "text" && (
              <Input
                value={typeof current === "string" ? current : ""}
                onChange={(e) => setField(field.name, e.target.value)}
                className="mt-1 h-8 text-sm"
                disabled={disabled}
              />
            )}

            {field.fieldType === "number" && (
              <Input
                type="number"
                value={typeof current === "number" ? current : ""}
                onChange={(e) => setField(field.name, e.target.value === "" ? undefined : Number(e.target.value))}
                className="mt-1 h-8 text-sm"
                disabled={disabled}
              />
            )}

            {field.fieldType === "date" && (
              <Input
                type="date"
                value={typeof current === "string" ? current : ""}
                onChange={(e) => setField(field.name, e.target.value || undefined)}
                className="mt-1 h-8 text-sm"
                disabled={disabled}
              />
            )}

            {field.fieldType === "boolean" && (
              <div className="mt-2 flex items-center">
                <Checkbox
                  checked={current === true}
                  onCheckedChange={(checked) => setField(field.name, checked === true)}
                  disabled={disabled}
                />
              </div>
            )}

            {field.fieldType === "select" && (
              <Select
                value={typeof current === "string" && current ? current : "_none"}
                onValueChange={(v) => setField(field.name, v === "_none" ? undefined : v)}
                disabled={disabled}
              >
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="— Select —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {field.fieldType === "multiselect" && (
              <div className="mt-1.5 flex flex-wrap gap-3">
                {(field.options ?? []).map((opt) => {
                  const selected = Array.isArray(current) && current.includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={selected}
                        disabled={disabled}
                        onCheckedChange={(checked) => {
                          const arr: string[] = Array.isArray(current) ? [...current] : [];
                          if (checked === true) {
                            if (!arr.includes(opt)) arr.push(opt);
                          } else {
                            const idx = arr.indexOf(opt);
                            if (idx >= 0) arr.splice(idx, 1);
                          }
                          setField(field.name, arr);
                        }}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
