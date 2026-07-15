import { useState, useMemo, useCallback } from "react";
import { unwrapList } from "@/lib/unwrap-list";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, addWeeks, subMonths, subWeeks,
  isSameMonth, isSameDay, isToday, startOfDay, isBefore, isAfter,
  parseISO,
} from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft, ChevronRight, CalendarDays, Loader2,
  CheckSquare, ListTodo, Users, Clock, Tag,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type CalView = "month" | "week" | "day";
type EventType = "meeting" | "task" | "action_item";

interface CalEvent {
  id: string;
  type: EventType;
  title: string;
  date: string | Date | null;
  status?: string;
  priority?: string;
  url?: string;
  projectName?: string;
  duration?: number;
  meta?: string;
}

const EVENT_COLORS: Record<EventType, { bg: string; text: string; border: string; dot: string }> = {
  meeting:     { bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-800 dark:text-blue-200",   border: "border-l-blue-500",   dot: "bg-blue-500" },
  task:        { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200", border: "border-l-green-500",  dot: "bg-green-500" },
  action_item: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200", border: "border-l-amber-500",  dot: "bg-amber-500" },
};

const EVENT_ICONS: Record<EventType, React.ComponentType<{ className?: string }>> = {
  meeting:     Users,
  task:        CheckSquare,
  action_item: ListTodo,
};

function eventDateMs(e: CalEvent): number {
  if (!e.date) return 0;
  const d = e.date instanceof Date ? e.date : parseISO(e.date as string);
  return d.getTime();
}

function EventChip({ event, compact = false }: { event: CalEvent; compact?: boolean }) {
  const colors = EVENT_COLORS[event.type];
  const Icon = EVENT_ICONS[event.type];
  const d = event.date instanceof Date ? event.date : event.date ? parseISO(event.date as string) : null;

  const chip = (
    <Link href={event.url ?? "/"}>
      <div className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border-l-2 cursor-pointer hover:opacity-80 transition-opacity truncate",
        colors.bg, colors.text, colors.border,
        compact ? "py-0.5" : "py-1",
      )}>
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate font-medium">{event.title}</span>
        {!compact && event.priority === "urgent" && (
          <span className="ml-auto text-red-500 shrink-0">!</span>
        )}
      </div>
    </Link>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p className="font-semibold">{event.title}</p>
        {d && <p className="text-xs text-muted-foreground">{format(d, "EEE, MMM d, yyyy")}</p>}
        {event.projectName && <p className="text-xs text-muted-foreground">{event.projectName}</p>}
        {event.status && <Badge variant="outline" className="text-[10px] mt-1 capitalize">{event.status.replace("_", " ")}</Badge>}
        {event.meta && <p className="text-xs text-muted-foreground mt-1">{event.meta}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function DayDetailDialog({
  day, events, open, onClose,
}: { day: Date | null; events: CalEvent[]; open: boolean; onClose: () => void }) {
  if (!day) return null;
  const key = format(day, "yyyy-MM-dd");
  const dayEvents = events
    .filter(e => {
      if (!e.date) return false;
      const d = e.date instanceof Date ? e.date : parseISO(e.date as string);
      return format(d, "yyyy-MM-dd") === key;
    })
    .sort((a, b) => {
      const order = { meeting: 0, task: 1, action_item: 2 };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });

  const groupsByType = [
    { type: "meeting" as EventType, label: "Meetings", items: dayEvents.filter(e => e.type === "meeting") },
    { type: "task" as EventType, label: "Tasks", items: dayEvents.filter(e => e.type === "task") },
    { type: "action_item" as EventType, label: "Action Items", items: dayEvents.filter(e => e.type === "action_item") },
  ].filter(g => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            {format(day, "EEEE, MMMM d, yyyy")}
          </DialogTitle>
        </DialogHeader>
        {dayEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No events on this day.</p>
        ) : (
          <div className="space-y-4">
            {groupsByType.map(({ type, label, items }) => {
              const colors = EVENT_COLORS[type];
              const Icon = EVENT_ICONS[type];
              return (
                <div key={type}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </h4>
                  <div className="space-y-1.5">
                    {items.map(event => (
                      <Link key={event.id} href={event.url ?? "/"} onClick={onClose}>
                        <div className={cn(
                          "flex items-start gap-2 p-2.5 rounded-lg border-l-2 cursor-pointer hover:opacity-80 transition-opacity",
                          colors.bg, colors.text, colors.border,
                        )}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{event.title}</p>
                            {event.projectName && <p className="text-xs opacity-70 mt-0.5">{event.projectName}</p>}
                            {event.status && <Badge variant="outline" className="text-[10px] mt-1 capitalize">{event.status.replace("_", " ")}</Badge>}
                            {event.priority && event.priority !== "normal" && (
                              <Badge variant="outline" className={cn("text-[10px] mt-1 ml-1 capitalize", event.priority === "urgent" && "border-red-500 text-red-600")}>
                                {event.priority}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MonthView({ events, currentDate, onDayClick }: { events: CalEvent[]; currentDate: Date; onDayClick: (day: Date) => void }) {
  const { t } = useI18n();
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: Date[] = [];
  let d = gridStart;
  while (!isAfter(d, gridEnd)) { days.push(d); d = addDays(d, 1); }

  const DAY_LABELS = [
    t("calendarMonday"), t("calendarTuesday"), t("calendarWednesday"),
    t("calendarThursday"), t("calendarFriday"), t("calendarSaturday"), t("calendarSunday"),
  ];

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    events.forEach(e => {
      if (!e.date) return;
      const key = format(e.date instanceof Date ? e.date : parseISO(e.date as string), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [events]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-7 border-b">
        {DAY_LABELS.map(label => (
          <div key={label} className="py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr border-l border-t overflow-auto">
        {days.map(day => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = (eventsByDay.get(key) ?? []).sort((a, b) => {
            const order = { meeting: 0, task: 1, action_item: 2 };
            return (order[a.type] ?? 3) - (order[b.type] ?? 3);
          });
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isT = isToday(day);

          return (
            <div
              key={key}
              onClick={() => onDayClick(day)}
              className={cn(
                "border-r border-b p-1 min-h-[90px] flex flex-col gap-0.5 cursor-pointer hover:bg-accent/40 transition-colors",
                !isCurrentMonth && "bg-muted/30 opacity-50",
                isT && "bg-primary/5",
              )}
            >
              <div className={cn(
                "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full shrink-0 self-end",
                isT ? "bg-primary text-primary-foreground" : "text-foreground",
                !isCurrentMonth && "text-muted-foreground",
              )}>
                {format(day, "d")}
              </div>
              {dayEvents.slice(0, 3).map(e => (
                <EventChip key={e.id} event={e} compact />
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ events, currentDate }: { events: CalEvent[]; currentDate: Date }) {
  const { t } = useI18n();
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    events.forEach(e => {
      if (!e.date) return;
      const key = format(e.date instanceof Date ? e.date : parseISO(e.date as string), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return map;
  }, [events]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      <div className="grid grid-cols-7 border-b shrink-0">
        {days.map(day => {
          const isT = isToday(day);
          return (
            <div key={day.toISOString()} className={cn("py-3 px-2 text-center border-r last:border-r-0", isT && "bg-primary/5")}>
              <div className="text-xs text-muted-foreground uppercase font-semibold">
                {format(day, "EEE")}
              </div>
              <div className={cn(
                "text-lg font-bold mt-0.5 w-8 h-8 flex items-center justify-center rounded-full mx-auto",
                isT ? "bg-primary text-primary-foreground" : "text-foreground",
              )}>
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 grid grid-cols-7 overflow-auto">
        {days.map(day => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const isT = isToday(day);

          return (
            <div key={key} className={cn("border-r last:border-r-0 p-2 flex flex-col gap-1.5 min-h-[200px]", isT && "bg-primary/5")}>
              {dayEvents.length === 0 && (
                <div className="text-xs text-muted-foreground/50 text-center mt-4">—</div>
              )}
              {dayEvents.map(e => <EventChip key={e.id} event={e} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ events, currentDate }: { events: CalEvent[]; currentDate: Date }) {
  const dayEvents = useMemo(() => {
    return events
      .filter(e => {
        if (!e.date) return false;
        const d = e.date instanceof Date ? e.date : parseISO(e.date as string);
        return isSameDay(d, currentDate);
      })
      .sort((a, b) => eventDateMs(a) - eventDateMs(b));
  }, [events, currentDate]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 border-b">
        <h2 className="text-xl font-semibold">{format(currentDate, "EEEE, MMMM d, yyyy")}</h2>
        <p className="text-sm text-muted-foreground">{dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}</p>
      </div>

      {dayEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No events scheduled for this day</p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {dayEvents.map(e => {
            const colors = EVENT_COLORS[e.type];
            const Icon = EVENT_ICONS[e.type];
            const d = e.date instanceof Date ? e.date : e.date ? parseISO(e.date as string) : null;

            return (
              <Link key={e.id} href={e.url ?? "/"}>
                <div className={cn(
                  "flex items-start gap-4 p-4 rounded-lg border-l-4 cursor-pointer hover:shadow-md transition-shadow",
                  colors.bg, colors.border,
                )}>
                  <div className={cn("mt-0.5 p-2 rounded-full", colors.bg)}>
                    <Icon className={cn("h-4 w-4", colors.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={cn("text-[10px] capitalize", colors.text)}>
                        {e.type.replace("_", " ")}
                      </Badge>
                      {e.priority === "urgent" && (
                        <Badge className="text-[10px] bg-red-100 text-red-700">Urgent</Badge>
                      )}
                    </div>
                    <h3 className={cn("font-semibold text-base", colors.text)}>{e.title}</h3>
                    {e.projectName && (
                      <p className="text-xs text-muted-foreground mt-0.5">{e.projectName}</p>
                    )}
                    {e.meta && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {e.meta}
                      </p>
                    )}
                    {e.status && (
                      <p className="text-xs text-muted-foreground mt-1 capitalize">
                        Status: {e.status.replace("_", " ")}
                      </p>
                    )}
                  </div>
                  {d && (
                    <div className="text-xs text-muted-foreground shrink-0">
                      {format(d, "h:mm a")}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const { t, isRtl } = useI18n();
  const [view, setView] = useState<CalView>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const rangeStart = useMemo(() => {
    if (view === "month") return startOfMonth(currentDate);
    if (view === "week") return startOfWeek(currentDate, { weekStartsOn: 1 });
    return startOfDay(currentDate);
  }, [view, currentDate]);

  const rangeEnd = useMemo(() => {
    if (view === "month") return endOfMonth(currentDate);
    if (view === "week") return endOfWeek(currentDate, { weekStartsOn: 1 });
    return addDays(startOfDay(currentDate), 1);
  }, [view, currentDate]);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-events", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const r = await fetch(
        `/api/calendar/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load calendar events");
      return r.json() as Promise<{ events: CalEvent[] }>;
    },
  });

  const events = useMemo(() => {
    const all = unwrapList<any>(data, "events");
    return typeFilter === "all" ? all : all.filter(e => e.type === typeFilter);
  }, [data, typeFilter]);

  const navigate = useCallback((dir: -1 | 1) => {
    setCurrentDate(d => {
      if (view === "month") return dir === 1 ? addMonths(d, 1) : subMonths(d, 1);
      if (view === "week")  return dir === 1 ? addWeeks(d, 1)  : subWeeks(d, 1);
      return addDays(d, dir);
    });
  }, [view]);

  const periodLabel = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }, [view, currentDate]);

  const meetingCount = events.filter(e => e.type === "meeting").length;
  const taskCount = events.filter(e => e.type === "task").length;
  const actionCount = events.filter(e => e.type === "action_item").length;

  return (
    <div className={cn("flex flex-col h-[calc(100vh-8rem)] -m-4 md:-m-6 lg:-m-8 rounded-xl overflow-hidden border bg-card shadow-sm", isRtl && "font-[Tahoma,Arial,sans-serif]")} dir={isRtl ? "rtl" : "ltr"}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20 shrink-0 flex-wrap gap-y-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3 ml-1" onClick={() => setCurrentDate(new Date())}>
            {t("calendarToday")}
          </Button>
        </div>

        <h2 className="font-semibold text-base flex-1 min-w-0 truncate">{periodLabel}</h2>

        {/* Event type filter */}
        <div className="flex items-center gap-1.5">
          {(["all", "meeting", "task", "action_item"] as const).map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                "flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
                typeFilter === type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {type !== "all" && <span className={cn("h-2 w-2 rounded-full", EVENT_COLORS[type as EventType].dot)} />}
              {type === "all" ? t("calendarAllEvents")
                : type === "meeting" ? t("calendarMeeting")
                : type === "task" ? t("calendarTask")
                : t("calendarActionItem")}
              <span className="opacity-70">
                {type === "all" ? events.length
                  : type === "meeting" ? meetingCount
                  : type === "task" ? taskCount
                  : actionCount}
              </span>
            </button>
          ))}
        </div>

        {/* View switcher */}
        <div className="flex items-center rounded-md border overflow-hidden">
          {(["month", "week", "day"] as CalView[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "text-xs px-3 py-1.5 transition-colors capitalize font-medium",
                view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground",
              )}
            >
              {v === "month" ? t("monthView") : v === "week" ? t("weekView") : t("dayView")}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {view === "month" && <MonthView events={events} currentDate={currentDate} onDayClick={setSelectedDay} />}
          {view === "week" && <WeekView events={events} currentDate={currentDate} />}
          {view === "day"  && <DayView  events={events} currentDate={currentDate} />}
        </>
      )}

      <DayDetailDialog
        day={selectedDay}
        events={events}
        open={!!selectedDay}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  );
}
