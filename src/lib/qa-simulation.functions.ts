import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_PASSWORD = "QaTest!2026";
const EMAIL_DOMAIN = "qa.lovable.test";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const ok = (data ?? []).some((r) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: admin only");
}

async function getActiveEventId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("id, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No active event found");
  return data.id;
}

function newRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `qa-${ts}-${rand}`;
}

export type SeedManifestEntry = {
  table_number: number;
  exhibitor_profile_id: string;
  exhibitor_auth_user_id: string;
  exhibitor_email: string;
  exhibitor_password: string;
  company_id: string;
  company_name: string;
  active_slot_count: number;
};

export const seedQaRound = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        tableNumbers: z.array(z.number().int().positive()).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const eventId = await getActiveEventId();
    const runId = newRunId();

    // Discover empty tables
    const { data: emptyTables, error: etErr } = await supabaseAdmin
      .from("event_tables")
      .select("id, table_number, exhibitor_profile_id")
      .eq("event_id", eventId)
      .is("exhibitor_profile_id", null)
      .order("table_number");
    if (etErr) throw new Error(etErr.message);

    let targets = (emptyTables ?? []).map((t) => ({ id: t.id, table_number: t.table_number }));
    if (data.tableNumbers && data.tableNumbers.length > 0) {
      const wanted = new Set(data.tableNumbers);
      targets = targets.filter((t) => wanted.has(t.table_number));
    }

    if (targets.length === 0) {
      return { run_id: runId, event_id: eventId, entries: [] as SeedManifestEntry[], skipped: "no_empty_tables" };
    }

    const entries: SeedManifestEntry[] = [];

    for (const t of targets) {
      const email = `${runId}-mesa${t.table_number}@${EMAIL_DOMAIN}`;
      const fullName = `QA Expositor Mesa ${t.table_number}`;
      const companyName = `QA ${runId} Mesa ${t.table_number}`;

      // 1) Create auth user (handle_new_user trigger creates profile row).
      const { data: created, error: cuErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName, preferred_language: "pt-BR" },
      });
      if (cuErr) throw new Error(`createUser failed for mesa ${t.table_number}: ${cuErr.message}`);
      const authUserId = created.user?.id;
      if (!authUserId) throw new Error(`createUser returned no user id for mesa ${t.table_number}`);

      // 2) Locate the profile row created by the trigger.
      const { data: prof, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);
      if (!prof) throw new Error(`profile not created for mesa ${t.table_number}`);

      // 3) Create QA company.
      const { data: comp, error: coErr } = await supabaseAdmin
        .from("companies")
        .insert({
          trade_name: companyName,
          legal_name: companyName,
          country_code: "BR",
          city: "São Paulo",
          qa_run_id: runId,
        })
        .select("id, trade_name")
        .single();
      if (coErr) throw new Error(`company insert failed for mesa ${t.table_number}: ${coErr.message}`);

      // 4) Tag + link profile.
      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ company_id: comp.id, qa_run_id: runId, full_name: fullName, is_active: true })
        .eq("id", prof.id);
      if (upErr) throw new Error(upErr.message);

      // 5) Assign role exhibitor (trigger creates exhibitor_profiles row).
      await supabaseAdmin.from("user_roles").delete().eq("user_id", authUserId);
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: authUserId, role: "exhibitor" });
      if (roleErr) throw new Error(roleErr.message);

      // Defensive: ensure exhibitor_profiles row exists.
      await supabaseAdmin
        .from("exhibitor_profiles")
        .upsert({ profile_id: prof.id }, { onConflict: "profile_id" });

      // 6) Assign to table.
      const { error: assignErr } = await supabaseAdmin
        .from("event_tables")
        .update({ exhibitor_profile_id: prof.id })
        .eq("id", t.id)
        .is("exhibitor_profile_id", null);
      if (assignErr) throw new Error(`table assign failed for mesa ${t.table_number}: ${assignErr.message}`);

      // 7) Verify active slots exist for this table. If missing, regenerate
      //    only this table's slots inline (no event-wide rebuild) so the
      //    QA exhibitor can actually receive bookings.
      const { count: slotCount } = await supabaseAdmin
        .from("time_slots")
        .select("id", { count: "exact", head: true })
        .eq("table_id", t.id)
        .eq("is_active", true);
      let activeSlotCount = slotCount ?? 0;
      if (activeSlotCount === 0) {
        // Reuse the slot grid from another active table in the same event.
        const { data: refTable } = await supabaseAdmin
          .from("event_tables")
          .select("id")
          .eq("event_id", eventId)
          .neq("id", t.id)
          .limit(1)
          .maybeSingle();
        if (refTable?.id) {
          const { data: refSlots } = await supabaseAdmin
            .from("time_slots")
            .select("start_at, end_at, is_buffer")
            .eq("table_id", refTable.id)
            .eq("is_active", true);
          if (refSlots && refSlots.length > 0) {
            await supabaseAdmin.from("time_slots").insert(
              refSlots.map((s) => ({
                event_id: eventId,
                table_id: t.id,
                start_at: s.start_at,
                end_at: s.end_at,
                is_buffer: s.is_buffer,
                is_active: true,
              })),
            );
            activeSlotCount = refSlots.length;
          }
        }
      }

      entries.push({
        table_number: t.table_number,
        exhibitor_profile_id: prof.id,
        exhibitor_auth_user_id: authUserId,
        exhibitor_email: email,
        exhibitor_password: DEFAULT_PASSWORD,
        company_id: comp.id,
        company_name: comp.trade_name,
        active_slot_count: activeSlotCount,
      });
    }

    return { run_id: runId, event_id: eventId, entries };
  });

export const cleanupQaRound = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ runId: z.string().min(3).max(64) }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const runId = data.runId;

    const report = {
      run_id: runId,
      meetings_deleted: 0,
      table_assignments_cleared: 0,
      auth_users_deleted: 0,
      profiles_removed: 0,
      companies_deleted: 0,
    };

    // 1) Collect QA profiles and companies.
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("qa_run_id", runId);
    const profileIds = (profs ?? []).map((p) => p.id);
    const authIds = (profs ?? []).map((p) => p.auth_user_id).filter((x): x is string => !!x);

    const { data: comps } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("qa_run_id", runId);
    const companyIds = (comps ?? []).map((c) => c.id);

    // 2) Find event tables owned by these QA exhibitors.
    let qaTableIds: string[] = [];
    if (profileIds.length > 0) {
      const { data: tbls } = await supabaseAdmin
        .from("event_tables")
        .select("id, exhibitor_profile_id")
        .in("exhibitor_profile_id", profileIds);
      qaTableIds = (tbls ?? []).map((t) => t.id);
    }

    // 3) Delete meetings touching either visitor profile or table.
    if (profileIds.length > 0 || qaTableIds.length > 0) {
      const orClauses: string[] = [];
      if (profileIds.length > 0) orClauses.push(`visitor_profile_id.in.(${profileIds.join(",")})`);
      if (qaTableIds.length > 0) orClauses.push(`table_id.in.(${qaTableIds.join(",")})`);
      const { data: delMeetings, error: dmErr } = await supabaseAdmin
        .from("meetings")
        .delete()
        .or(orClauses.join(","))
        .select("id");
      if (dmErr) throw new Error(`meetings delete failed: ${dmErr.message}`);
      report.meetings_deleted = (delMeetings ?? []).length;
    }

    // 4) Clear table assignments (FK ON DELETE SET NULL would also do this, but
    //    we want to log the count and make sure tables are visibly "Sem expositor").
    if (profileIds.length > 0) {
      const { data: cleared, error: clErr } = await supabaseAdmin
        .from("event_tables")
        .update({ exhibitor_profile_id: null })
        .in("exhibitor_profile_id", profileIds)
        .select("id");
      if (clErr) throw new Error(`event_tables clear failed: ${clErr.message}`);
      report.table_assignments_cleared = (cleared ?? []).length;
    }

    // 5) Delete auth users (cascades profiles, user_roles, exhibitor_profiles, etc.).
    for (const uid of authIds) {
      const { error: duErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (!duErr) report.auth_users_deleted += 1;
    }
    report.profiles_removed = profileIds.length;

    // 6) Delete QA companies.
    if (companyIds.length > 0) {
      const { data: delComps, error: dcErr } = await supabaseAdmin
        .from("companies")
        .delete()
        .in("id", companyIds)
        .select("id");
      if (dcErr) throw new Error(`companies delete failed: ${dcErr.message}`);
      report.companies_deleted = (delComps ?? []).length;
    }

    return report;
  });

export const listQaRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("qa_run_id")
      .not("qa_run_id", "is", null);
    const counts = new Map<string, number>();
    for (const p of profs ?? []) {
      if (!p.qa_run_id) continue;
      counts.set(p.qa_run_id, (counts.get(p.qa_run_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([run_id, profile_count]) => ({ run_id, profile_count }))
      .sort((a, b) => (a.run_id < b.run_id ? 1 : -1));
  });