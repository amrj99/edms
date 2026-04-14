import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  FileText, Send, Link2, Mail,
  Loader2, Clock, ExternalLink, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityEventType = "revision" | "transmittal" | "chain" | "correspondence";

export interface ActivityEvent {
  id:     string;
  type:   ActivityEventType;
  date:   string;
  title:  string;
  status: string | null;
  meta:   Record<string, string | null>;
  href:   string;
}

// ─── Per-type visual config ───────────────────────────────────────────────────

const TYPE_CONFIG: Record<ActivityEventType, {
  icon:    React.ElementType;
  label:   string;
  dotBg:   string;
  iconColor: string;
  badgeBg: string;
}> = {
  revision: {
    icon:      FileText,
    label:     "Revision",
    dotBg:     "bg-blue-100 border-blue-200",
    iconColor: "text-blue-600",
    badgeBg:   "bg-blue-50 text-blue-700 border-blue-200",
  },
  transmittal: {
    icon:      Send,
    label:     "Transmittal",
    dotBg:     "bg-amber-100 border-amber-200",
    iconColor: "text-amber-600",
    badgeBg:   "bg-amber-50 text-amber-700 border-amber-200",
  },
  chain: {
    icon:      Link2,
    label:     "Submission Chain",
    dotBg:     "bg-emerald-100 border-emerald-200",
    iconColor: "text-emerald-600",
    badgeBg:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  // Correspondence is not yet linked, but the config is ready for when it is
  correspondence: {
    icon:      Mail,
    label:     "Correspondence",
    dotBg:     "bg-violet-100 border-violet-200",
    iconColor: "text-violet-600",
    badgeBg:   "bg-violet-50 text-violet-700 border-violet-200",
  },
};

const STATUS_LABELS: Record<string, string> = {
  draft:                  "Draft",
  sent:                   "Sent",
  acknowledged:           "Acknowledged",
  pending_approval:       "Pending Approval",
  approved:               "Approved",
  approved_with_comments: "Approved w/ Comments",
  for_revision:           "For Revision",
  rejected:               "Rejected",
  under_review:           "Under Review",
  issued:                 "Issued",
  superseded:             "Superseded",
  in_progress:            "In Progress",
  complete:               "Complete",
  archived:               "Archived",
  obsolete:               "Obsolete",
  void:                   "Void",
};

// ─── Sub-line per event type ──────────────────────────────────────────────────

function EventSubline({ event }: { event: ActivityEvent }) {
  const { type, meta } = event;
  if (type === "revision") {
    const parts: string[] = [];
    if (meta.revision)       parts.push(`Rev ${meta.revision}`);
    if (meta.createdByName)  parts.push(`by ${meta.createdByName}`);
    if (meta.fileName)       parts.push(meta.fileName);
    return parts.length > 0 ? <span>{parts.join(" · ")}</span> : null;
  }
  if (type === "transmittal") {
    const parts: string[] = [];
    if (meta.direction)   parts.push(meta.direction === "outgoing" ? "Outgoing" : "Incoming");
    if (meta.purpose)     parts.push(meta.purpose.replace(/_/g, " "));
    if (meta.toExternal)  parts.push(`To: ${meta.toExternal}`);
    if (meta.dueDate)     parts.push(`Due ${format(new Date(meta.dueDate), "dd MMM yyyy")}`);
    return parts.length > 0 ? <span>{parts.join(" · ")}</span> : null;
  }
  if (type === "chain") {
    if (meta.chainRef) return <span>Ref: {meta.chainRef}</span>;
    return null;
  }
  if (type === "correspondence") {
    const parts: string[] = [];
    if (meta.referenceNumber) parts.push(meta.referenceNumber);
    if (meta.direction)       parts.push(meta.direction === "outgoing" ? "Outgoing" : "Incoming");
    return parts.length > 0 ? <span>{parts.join(" · ")}</span> : null;
  }
  return null;
}

// ─── Single timeline row ──────────────────────────────────────────────────────

function TimelineEvent({
  event,
  isLast,
  onNavigate,
}: {
  event: ActivityEvent;
  isLast: boolean;
  onNavigate: (href: string) => void;
}) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.revision;
  const Icon = cfg.icon;
  const dateObj = new Date(event.date);
  const statusLabel = event.status ? (STATUS_LABELS[event.status] ?? event.status.replace(/_/g, " ")) : null;

  return (
    <div className="flex gap-4">
      {/* Vertical line + icon dot */}
      <div className="flex flex-col items-center">
        <div className={cn(
          "h-8 w-8 rounded-full border-2 flex items-center justify-center shrink-0 z-10",
          cfg.dotBg,
        )}>
          <Icon className={cn("h-3.5 w-3.5", cfg.iconColor)} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content card */}
      <div className={cn("flex-1 pb-6", isLast && "pb-0")}>
        <div className="rounded-lg border bg-card hover:bg-accent/30 transition-colors p-3.5">
          {/* Top row: type badge + date */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
              cfg.badgeBg,
            )}>
              <Icon className="h-2.5 w-2.5" />
              {cfg.label}
            </span>
            {statusLabel && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {statusLabel}
              </Badge>
            )}
            <div className="flex items-center gap-1 ms-auto text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <time
                dateTime={event.date}
                title={format(dateObj, "dd MMM yyyy, HH:mm")}
              >
                {formatDistanceToNow(dateObj, { addSuffix: true })}
              </time>
            </div>
          </div>

          {/* Title */}
          <p className="text-sm font-medium leading-snug">{event.title}</p>

          {/* Sub-line */}
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            <EventSubline event={event} />
          </p>

          {/* Footer: absolute date + view button */}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-dashed">
            <time className="text-[11px] text-muted-foreground/70">
              {format(dateObj, "dd MMM yyyy")}
            </time>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 text-primary hover:text-primary"
              onClick={() => onNavigate(event.href)}
            >
              View <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

interface DocumentActivityTabProps {
  documentId: number;
  projectId:  number;
}

export function DocumentActivityTab({ documentId, projectId }: DocumentActivityTabProps) {
  const [, navigate] = useLocation();

  const { data, isLoading, isError } = useQuery<{ events: ActivityEvent[]; total: number }>({
    queryKey: ["document-activity", documentId],
    queryFn: async () => {
      const r = await fetch(
        `/api/projects/${projectId}/documents/${documentId}/activity`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`Failed to load activity: ${r.status}`);
      return r.json();
    },
    enabled: !!documentId && !!projectId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading activity…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Info className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Could not load activity</p>
        <p className="text-xs text-muted-foreground">Please refresh the page or try again later.</p>
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Clock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Revisions uploaded, transmittals, and submission chains will appear here.
          </p>
        </div>
      </div>
    );
  }

  // Group by calendar date for day separators
  const byDay: { label: string; events: ActivityEvent[] }[] = [];
  let currentDay = "";
  for (const event of events) {
    const day = format(new Date(event.date), "dd MMM yyyy");
    if (day !== currentDay) {
      byDay.push({ label: day, events: [] });
      currentDay = day;
    }
    byDay[byDay.length - 1].events.push(event);
  }

  return (
    <div className="space-y-2">
      {/* Summary strip */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pb-2 border-b flex-wrap">
        <span className="font-medium text-foreground">{events.length} event{events.length !== 1 ? "s" : ""} in document history</span>
        {Object.entries(
          events.reduce((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; }, {} as Record<string, number>)
        ).map(([type, count]) => {
          const cfg = TYPE_CONFIG[type as ActivityEventType];
          if (!cfg) return null;
          const Icon = cfg.icon;
          return (
            <span key={type} className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium", cfg.badgeBg)}>
              <Icon className="h-2.5 w-2.5" /> {count} {cfg.label}{count !== 1 ? "s" : ""}
            </span>
          );
        })}
        <span className="ms-auto text-[10px] italic">Correspondence linking coming soon</span>
      </div>

      {/* Timeline grouped by day */}
      <div className="pt-4">
        {byDay.map((group, gi) => (
          <div key={gi}>
            {/* Day separator */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
                {group.label}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Events for this day */}
            <div>
              {group.events.map((event, i) => {
                const isLastInGroup = i === group.events.length - 1;
                const isLastGroup   = gi === byDay.length - 1;
                return (
                  <TimelineEvent
                    key={event.id}
                    event={event}
                    isLast={isLastInGroup && isLastGroup}
                    onNavigate={navigate}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
