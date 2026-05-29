import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

export type SkillContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  profileId: string | null;
  isStaff: boolean;
};

export type SkillDef = {
  key: string;
  scope: "public" | "staff";
  schema: z.ZodTypeAny;
  execute: (ctx: SkillContext, args: unknown) => Promise<unknown>;
};

function assertStaff(ctx: SkillContext) {
  if (!ctx.isStaff) throw new Error("Skill restrita a admin/staff");
}

const skills: SkillDef[] = [
  {
    key: "get_event_info",
    scope: "public",
    schema: z.object({ event_id: z.string().uuid() }),
    execute: async (ctx, args) => {
      const { event_id } = args as { event_id: string };
      const { data, error } = await ctx.supabase.from("events").select("*").eq("id", event_id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "list_exhibitors",
    scope: "public",
    schema: z.object({ event_id: z.string().uuid(), query: z.string().optional() }),
    execute: async (ctx, args) => {
      const { event_id, query } = args as { event_id: string; query?: string };
      const { data: tables } = await ctx.supabase
        .from("event_tables")
        .select("id, table_number, exhibitor_profile_id")
        .eq("event_id", event_id)
        .not("exhibitor_profile_id", "is", null);
      const ids = (tables ?? []).map((t) => t.exhibitor_profile_id).filter(Boolean) as string[];
      if (ids.length === 0) return [];
      const { data: profiles } = await ctx.supabase
        .from("profiles")
        .select("id, full_name, company:companies(trade_name, country_code, city)")
        .in("id", ids);
      let rows = (profiles ?? []).map((p) => ({
        profile_id: p.id,
        name: p.full_name,
        company: p.company,
        table_number: tables?.find((t) => t.exhibitor_profile_id === p.id)?.table_number,
      }));
      if (query) {
        const q = query.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.name?.toLowerCase().includes(q) ||
            (r.company as { trade_name?: string } | null)?.trade_name?.toLowerCase().includes(q),
        );
      }
      return rows;
    },
  },
  {
    key: "get_my_meetings",
    scope: "public",
    schema: z.object({ event_id: z.string().uuid() }),
    execute: async (ctx, args) => {
      const { event_id } = args as { event_id: string };
      if (!ctx.profileId) return [];
      const { data: asVisitor } = await ctx.supabase
        .from("meetings")
        .select("id, status, slot:time_slots(start_at, end_at), table:event_tables(table_number, exhibitor_profile_id)")
        .eq("event_id", event_id)
        .eq("visitor_profile_id", ctx.profileId);
      const { data: tablesOwned } = await ctx.supabase
        .from("event_tables")
        .select("id")
        .eq("event_id", event_id)
        .eq("exhibitor_profile_id", ctx.profileId);
      const tableIds = (tablesOwned ?? []).map((t) => t.id);
      let asExh: unknown[] = [];
      if (tableIds.length > 0) {
        const { data } = await ctx.supabase
          .from("meetings")
          .select("id, status, slot:time_slots(start_at, end_at), visitor_profile_id, table_id")
          .in("table_id", tableIds);
        asExh = data ?? [];
      }
      return { as_visitor: asVisitor ?? [], as_exhibitor: asExh };
    },
  },
  {
    key: "get_meeting_details",
    scope: "public",
    schema: z.object({ meeting_id: z.string().uuid() }),
    execute: async (ctx, args) => {
      const { meeting_id } = args as { meeting_id: string };
      const { data, error } = await ctx.supabase
        .from("meetings")
        .select("*, slot:time_slots(*), table:event_tables(*)")
        .eq("id", meeting_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "list_meetings_by_table",
    scope: "staff",
    schema: z.object({ event_id: z.string().uuid(), table_id: z.string().uuid() }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { event_id, table_id } = args as { event_id: string; table_id: string };
      const { data, error } = await ctx.supabase
        .from("meetings")
        .select("id, status, visitor_profile_id, slot:time_slots(start_at, end_at)")
        .eq("event_id", event_id)
        .eq("table_id", table_id);
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "list_meetings_by_timeslot",
    scope: "staff",
    schema: z.object({ event_id: z.string().uuid(), start_at: z.string() }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { event_id, start_at } = args as { event_id: string; start_at: string };
      const { data: slots } = await ctx.supabase
        .from("time_slots")
        .select("id")
        .eq("event_id", event_id)
        .eq("start_at", start_at);
      const ids = (slots ?? []).map((s) => s.id);
      if (ids.length === 0) return [];
      const { data, error } = await ctx.supabase
        .from("meetings")
        .select("id, status, visitor_profile_id, table_id, slot_id")
        .in("slot_id", ids);
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "mark_general_checkin",
    scope: "staff",
    schema: z.object({
      event_id: z.string().uuid(),
      profile_id: z.string().uuid(),
      method: z.enum(["qr", "manual"]).optional(),
    }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { event_id, profile_id, method } = args as {
        event_id: string;
        profile_id: string;
        method?: "qr" | "manual";
      };
      const { data, error } = await ctx.supabase
        .from("general_checkins")
        .insert({ event_id, profile_id, method: method ?? "manual" })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "mark_meeting_checkin",
    scope: "staff",
    schema: z.object({
      meeting_id: z.string().uuid(),
      status: z.enum(["present", "no_show", "late"]),
      late_minutes: z.number().optional(),
    }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { meeting_id, status, late_minutes } = args as {
        meeting_id: string;
        status: "present" | "no_show" | "late";
        late_minutes?: number;
      };
      const { data, error } = await ctx.supabase
        .from("meeting_checkins")
        .insert({ meeting_id, status, late_minutes: late_minutes ?? null, by_role: "staff" })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "mark_no_show",
    scope: "staff",
    schema: z.object({ meeting_id: z.string().uuid() }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { meeting_id } = args as { meeting_id: string };
      await ctx.supabase.from("meetings").update({ status: "no_show" }).eq("id", meeting_id);
      const { data, error } = await ctx.supabase
        .from("meeting_checkins")
        .insert({ meeting_id, status: "no_show", by_role: "staff" })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    key: "set_meeting_outcome",
    scope: "staff",
    schema: z.object({
      meeting_id: z.string().uuid(),
      outcome: z.enum(["hot", "warm", "cold"]),
      notes: z.string().optional(),
      next_steps: z.string().optional(),
    }),
    execute: async (ctx, args) => {
      assertStaff(ctx);
      const { meeting_id, outcome, notes, next_steps } = args as {
        meeting_id: string;
        outcome: "hot" | "warm" | "cold";
        notes?: string;
        next_steps?: string;
      };
      const { data, error } = await ctx.supabase
        .from("meeting_outcomes")
        .insert({ meeting_id, outcome, notes: notes ?? null, next_steps: next_steps ?? null })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  },
];

export const skillRegistry: Record<string, SkillDef> = Object.fromEntries(
  skills.map((s) => [s.key, s]),
);

export async function executeSkill(key: string, ctx: SkillContext, args: unknown): Promise<unknown> {
  const def = skillRegistry[key];
  if (!def) throw new Error(`Skill desconhecida: ${key}`);
  const parsed = def.schema.parse(args ?? {});
  return def.execute(ctx, parsed);
}