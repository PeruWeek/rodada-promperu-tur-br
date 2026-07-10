/**
 * Global event selector for the Admin header.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAdminEvent } from "@/hooks/use-admin-event";
import { useSiteContext } from "@/lib/site-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AdminEventSelector() {
  const { eventId, setEventId } = useAdminEvent();
  const site = useSiteContext();

  const { data: events } = useQuery({
    queryKey: ["admin-events-selector"],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, event_date")
        .order("event_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    staleTime: 60_000,
  });

  if (!events || events.length === 0) return null;

  const currentId = eventId ?? site.activeEventId ?? events[0]?.id ?? null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground hidden sm:inline">Evento:</span>
      <Select
        value={currentId ?? undefined}
        onValueChange={(v) => setEventId(v)}
      >
        <SelectTrigger className="h-8 min-w-[200px] text-sm">
          <SelectValue placeholder="Selecionar evento" />
        </SelectTrigger>
        <SelectContent>
          {events.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
              {site.activeEventId === e.id ? " · padrão" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}