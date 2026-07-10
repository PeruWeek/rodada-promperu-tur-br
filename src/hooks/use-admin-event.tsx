/**
 * Admin event selector context — replaces the "last event created"
 * implicit selection. Default is the site's `active_event_id`; the admin
 * can override via the global selector rendered in the Admin header. The
 * choice is persisted per-browser in localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useSiteContext } from "@/lib/site-context";

const STORAGE_KEY = "admin:selected-event-id";

type AdminEventContextValue = {
  eventId: string | null;
  setEventId: (id: string | null) => void;
};

const Ctx = createContext<AdminEventContextValue | null>(null);

export function AdminEventProvider({ children }: { children: ReactNode }) {
  const site = useSiteContext();
  const [eventId, setEventIdState] = useState<string | null>(site.activeEventId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    if (persisted) setEventIdState(persisted);
  }, []);

  const setEventId = useCallback((id: string | null) => {
    setEventIdState(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo(() => ({ eventId, setEventId }), [eventId, setEventId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminEvent(): AdminEventContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminEvent must be used inside <AdminEventProvider>");
  return v;
}