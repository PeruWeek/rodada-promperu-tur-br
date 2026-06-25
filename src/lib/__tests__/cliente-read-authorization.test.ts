import { describe, expect, it, beforeEach } from "vitest";

import { _listEventRegistrantsImpl } from "@/lib/staff-exports.functions";
import { createSupabaseMock, rolesFor } from "@/test/supabase-mock";
import { assertNoSemAgendamento } from "@/test/invariants";

const EVENT_ID = "00000000-0000-0000-0000-0000000000aa";
const CLIENTE_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const VISITOR_ID = "33333333-3333-3333-3333-333333333333";

function pipelineRow(overrides: Partial<Record<string, any>>) {
  return {
    id: crypto.randomUUID(),
    event_id: EVENT_ID,
    company_id: crypto.randomUUID(),
    primary_profile_id: crypto.randomUUID(),
    company_role: "visitor",
    company_trade_name: "Empresa",
    company_legal_name: "Empresa LTDA",
    country_code: "BR",
    state_code: "SP",
    city: "São Paulo",
    registration_status: "registered",
    scheduling_status: "sem_agendamento",
    scheduled_meetings_count: 0,
    primary_contact_name: "Contato",
    primary_contact_email: "c@example.com",
    primary_contact_phone: null,
    primary_contact_whatsapp: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function setupDataset(mock: ReturnType<typeof createSupabaseMock>, rows: any[]) {
  const profiles = rows
    .filter((r) => r.primary_profile_id)
    .map((r) => ({
      id: r.primary_profile_id,
      job_title: null,
      phone: null,
      whatsapp: null,
      auth_user_id: VISITOR_ID,
      is_active: true,
    }));
  const companies = rows
    .filter((r) => r.company_id)
    .map((r) => ({ id: r.company_id, tax_id: null }));
  mock.setDataset({
    events: [{ id: EVENT_ID, created_at: new Date().toISOString() }],
    v_company_event_pipeline: rows,
    profiles,
    companies,
    user_roles: [
      ...rolesFor(CLIENTE_ID, "cliente"),
      ...rolesFor(ADMIN_ID, "admin"),
      ...rolesFor(VISITOR_ID, "visitor"),
    ],
  });
}

describe("listEventRegistrants — cliente authorization", () => {
  let mock: ReturnType<typeof createSupabaseMock>;

  beforeEach(() => {
    mock = createSupabaseMock();
  });

  it("FAILS LOUDLY if cliente sees any sem_agendamento record (server-side override)", async () => {
    const rows = [
      pipelineRow({ scheduling_status: "agendado_ok", scheduled_meetings_count: 6 }),
      pipelineRow({ scheduling_status: "agendado_parcial", scheduled_meetings_count: 2 }),
      pipelineRow({ scheduling_status: "sem_agendamento", scheduled_meetings_count: 0 }), // must be filtered out
      pipelineRow({ scheduling_status: "sem_agendamento", scheduled_meetings_count: 0 }), // must be filtered out
    ];
    setupDataset(mock, rows);

    const result = await _listEventRegistrantsImpl(
      // Hostile input: cliente tries to bypass the filter by passing all statuses.
      {
        role: "all",
        schedulingStatuses: ["sem_agendamento", "agendado_parcial", "agendado_ok"],
      },
      { userId: CLIENTE_ID, supabase: mock.client },
    );

    expect(result.rows.length).toBe(2);
    // Invariant: zero leak of sem_agendamento for cliente.
    assertNoSemAgendamento(result.rows);
  });

  it("PATHOLOGICAL: count vence o texto — scheduling_status='agendado_ok' com count=0 NUNCA aparece para cliente", async () => {
    const rows = [
      // Texto legado/inconsistente; count real = 0 ⇒ deve ser ocultado.
      pipelineRow({ scheduling_status: "agendado_ok", scheduled_meetings_count: 0 }),
      pipelineRow({ scheduling_status: "agendado_parcial", scheduled_meetings_count: 0 }),
      // Caso válido (count > 0) deve aparecer.
      pipelineRow({ scheduling_status: "agendado_ok", scheduled_meetings_count: 8 }),
    ];
    setupDataset(mock, rows);

    const result = await _listEventRegistrantsImpl(
      { role: "all" },
      { userId: CLIENTE_ID, supabase: mock.client },
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].scheduled_meetings_count).toBe(8);
    for (const r of result.rows) {
      expect(r.scheduled_meetings_count).toBeGreaterThan(0);
    }
  });

  it("admin sees ALL statuses including sem_agendamento", async () => {
    const rows = [
      pipelineRow({ scheduling_status: "agendado_ok" }),
      pipelineRow({ scheduling_status: "sem_agendamento" }),
    ];
    setupDataset(mock, rows);

    const result = await _listEventRegistrantsImpl(
      { role: "all" },
      { userId: ADMIN_ID, supabase: mock.client },
    );
    expect(result.rows.length).toBe(2);
  });

  it("non-admin/staff/cliente roles are rejected with Forbidden", async () => {
    setupDataset(mock, []);
    await expect(
      _listEventRegistrantsImpl(
        { role: "all" },
        { userId: VISITOR_ID, supabase: mock.client },
      ),
    ).rejects.toThrow(/Forbidden/);
  });
});