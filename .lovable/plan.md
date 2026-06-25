## Objetivo

Estender o plano anterior (visão `cliente` restrita a empresas agendadas + enforcement server-side) adicionando **testes automatizados** que validem a autorização do papel `cliente` nas server functions alteradas, com **dois invariantes obrigatórios e explícitos**:

1. **Leitura**: nenhuma chamada de leitura feita por um caller `cliente` pode retornar um registro com `scheduling_status === "sem_agendamento"`.
2. **Escrita**: nenhuma mutation pode retornar sucesso para um caller `cliente` — deve `throw "Forbidden"`.

Qualquer violação desses invariantes faz o teste correspondente falhar com mensagem explícita.

## Setup de teste (projeto ainda não tem)

- Adicionar dev deps: `vitest`, `@vitest/coverage-v8`.
- `vitest.config.ts`: `environment: "node"`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.test.ts"]`, alias `@/` → `./src`.
- Scripts em `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`.
- `src/test/setup.ts`: stubs de env (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

## Estratégia

Sem banco real. Mock de `@/integrations/supabase/client.server` (`supabaseAdmin`) via `vi.mock` com um fake querybuilder fluente que:

- Aplica filtros (`.eq`, `.in`, `.or`, `.not`, `.limit`, `.order`) sobre datasets injetados por teste.
- Registra a sequência de calls para asserts adicionais (ex.: confirmar `.in("scheduling_status", ["agendado_ok","agendado_parcial"])`).
- Para `user_roles`: devolve as roles do `userId` simulado.

Helper `src/test/supabase-mock.ts` + helper `callAs(impl, { userId, input })` que monta `context = { userId, supabase: mock, claims: {} }` e chama o `_Impl` puro.

## Refator mínimo para testabilidade

Extrair o corpo das server functions para `_Impl` puras (sem alterar comportamento):

```ts
export async function _listAdminCompaniesImpl(data, ctx) { ... }
export const listAdminCompanies = createServerFn(...)
  .middleware([requireSupabaseAuth])
  .inputValidator(...)
  .handler(({ data, context }) => _listAdminCompaniesImpl(data, context));
```

Aplicar a: `listAdminCompanies`, `getCompanyForEdit`, `listEventRegistrants`, e cada mutation auditada.

## Invariante 1 — Leitura nunca expõe `sem_agendamento` ao cliente

Helper compartilhado:

```ts
// src/test/invariants.ts
export function assertNoSemAgendamento(rows: Array<{ scheduling_status?: string | null }>) {
  const leaked = rows.filter((r) => r.scheduling_status === "sem_agendamento");
  if (leaked.length > 0) {
    throw new Error(
      `[cliente-auth] Leak: ${leaked.length} registro(s) com scheduling_status="sem_agendamento" ` +
      `vazaram para o caller cliente: ${JSON.stringify(leaked.map((r) => r))}`,
    );
  }
}
```

### Suítes que usam o invariante

**`src/lib/__tests__/list-event-registrants.cliente.test.ts`**

Dataset por teste tem mistura intencional de `agendado_ok`, `agendado_parcial` e `sem_agendamento` (≥1 de cada). Cada caso chama `assertNoSemAgendamento(result.rows)`.

- Caller `cliente`, input vazio → invariante.
- Caller `cliente`, input `schedulingStatuses: ["sem_agendamento"]` (tentativa de bypass) → invariante + asserção que a query final contém `.in("scheduling_status", ["agendado_ok","agendado_parcial"])`.
- Caller `cliente`, input `schedulingStatuses: ["agendado_ok","sem_agendamento","agendado_parcial"]` → invariante (override total).
- Caller `admin` com `schedulingStatuses: ["sem_agendamento"]` → retorna `sem_agendamento` normalmente (controle negativo: prova que o filtro é específico do cliente, não global).

**`src/lib/__tests__/list-admin-companies.cliente.test.ts`**

Dataset com 3 empresas: uma `agendado_ok`, uma `agendado_parcial`, uma `sem_agendamento`.

- Caller `cliente` retorna 2 empresas; `assertNoSemAgendamento` aplicado sobre o join com pipeline.
- Caller `cliente` tentando `role: "all"`, `status: "inactive"`, `confirmed: "no"` → server força `role=visitor`, `status=active`, `confirmed=yes`, `activeOnly=true` (asserts diretos nos filtros aplicados).
- Caller `admin` com `status: "all"` → as 3 empresas voltam (controle negativo).

**`src/lib/__tests__/get-company-for-edit.cliente.test.ts`**

- Caller `cliente` → `await expect(...).rejects.toThrow(/Forbidden/)`.
- Caller `admin`/`staff` → resolve.

## Invariante 2 — Escrita sempre falha para o cliente

Helper:

```ts
// src/test/invariants.ts
export async function expectClienteWriteBlocked(label: string, fn: () => Promise<unknown>) {
  let result: unknown;
  let threw: unknown = null;
  try { result = await fn(); } catch (e) { threw = e; }
  if (threw == null) {
    throw new Error(
      `[cliente-auth] Mutation "${label}" retornou sucesso para caller cliente ` +
      `(resultado: ${JSON.stringify(result)}). Toda mutation deve throw Forbidden.`,
    );
  }
  const msg = String((threw as Error).message ?? threw);
  if (!/forbidden/i.test(msg)) {
    throw new Error(
      `[cliente-auth] Mutation "${label}" lançou erro inesperado para cliente: ${msg}. ` +
      `Esperado: mensagem contendo "Forbidden".`,
    );
  }
}
```

### Suíte `src/lib/__tests__/cliente-write-blocks.test.ts`

Tabela de mutations (com input mínimo válido para cada uma). Para cada entrada, executa `expectClienteWriteBlocked(name, () => impl(input, ctxCliente))`:

- `adminHardDeleteCompany`, `adminReactivateCompany`, `setVisitorLunchParticipation`
- `adminUpdateUserProfile`, `adminUpdateUserEmail`, `adminUpsertUserCompany`
- `adminSetPrimaryRole`, `adminSendRecoveryEmail`, `adminConfirmEmail`
- `adminCreateConfirmedUser`, `adminDeleteUser`, `adminSetPassword`
- `assignExhibitorToTable`, `createEventTable`, `updateEventTable`, `deleteEventTable`
- `rebuildSlots`, `reviewExhibitorRequest`
- `addCompanyContact`, `reassignCompanyContact`

Controle positivo (uma asserção por arquivo): a mesma chamada com caller `admin` resolve sem throw `Forbidden`.

## Mutation testing manual (sanity)

Após implementar, comentar temporariamente o override em `_listEventRegistrantsImpl` e o `assertAdminOrStaff` em uma mutation; rodar `bun run test` e confirmar que:

- A suíte de `list-event-registrants` falha com a mensagem `[cliente-auth] Leak: ...`.
- A suíte `cliente-write-blocks` falha com `[cliente-auth] Mutation "..." retornou sucesso para caller cliente ...`.

Reverter. Isso valida que os invariantes têm bite real.

## Fora de escopo

- E2E com banco real / Playwright.
- Testes de UI.
- CI pipeline.
