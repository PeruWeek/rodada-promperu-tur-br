## Objetivo

Adicionar à área `cliente` em `/admin` uma nova aba **`Visão geral`** somente leitura, com KPIs simples e tabela de empresas visíveis. Fonte única da verdade da regra de agendamento: `scheduled_meetings_count` via `bucketGroupFromMeetings` (`src/lib/scheduling-status.ts`).

## Estrutura final das abas do cliente

1. `Visão geral` — **nova, padrão**
2. `Empresas` — inalterada
3. `Agendamentos` — inalterada

## Arquivos

### Criar

- **`src/lib/cliente-overview.ts`** — util puro com `computeClienteKpis(rows)`:
  - `inscritas = rows.length`
  - `comAgendamento = rows.filter(r => bucketGroupFromMeetings(r.scheduled_meetings_count ?? 0) === "com_agendamento").length`
  - `totalReunioes = rows.reduce((s, r) => s + (r.scheduled_meetings_count ?? 0), 0)`
  - `percentComAgendamento = inscritas > 0 ? Math.round((comAgendamento / inscritas) * 100) : 0`
  - Também exporta `formatLocation({ city, state, country })` que concatena apenas o que existir (sem inventar fallback).

- **`src/components/admin/cliente/cliente-overview.tsx`** — client component:
  - `useServerFn(listEventRegistrants)` + `useQuery` com os mesmos parâmetros usados hoje pela aba `Agendamentos` do cliente, **exceto** sem `onlyWithMeetings` (a Visão Geral consome o conjunto que o servidor já permite para `cliente`; o servidor já força `scheduled_meetings_count > 0` para esse perfil).
  - Faixa superior em `grid sm:grid-cols-2 lg:grid-cols-4` com 4 `Kpi` cards: Empresas inscritas, Empresas com agendamento, Total de reuniões, % com agendamento.
  - Card `Empresas sem agendamento` **não é renderizado** (servidor não expõe esses registros ao cliente).
  - Abaixo: `Input` de busca por nome (case-insensitive, client-side) + `Select` de status preparado para `Todos / Com agendamento / Sem agendamento`, **renderizado apenas se houver mais de um bucket presente** nos dados (no MVP fica oculto).
  - Tabela ordenada por `company_name`. Colunas:
    - `Empresa` → `company_name`
    - `Localidade` → `formatLocation(...)`
    - `Status da agenda` → badge derivado por `bucketGroupFromMeetings(count)` (no MVP sempre `Com agendamento`)
    - `Qtd. de reuniões` → `scheduled_meetings_count`
    - `Última atualização` → renderizada **somente se** ao menos uma linha tiver `updated_at` ou `pipeline_updated_at`; caso contrário a coluna é omitida do `<thead>` e `<tbody>`.
  - Sem ações por linha, sem export, sem botões administrativos.
  - Estado vazio com `cliente.overview.empty`.

### Editar

- **`src/routes/_authenticated/admin.tsx`** — apenas o ramo `isClienteOnly`:
  - Adicionar `<TabsTrigger value="overview">` como **primeiro** item.
  - `<Tabs defaultValue="overview" ...>`.
  - `<TabsContent value="overview"><ClienteOverview /></TabsContent>`.
  - Abas `companies` e `meetings` permanecem idênticas.

- **`src/lib/i18n/pt-BR.json`** e **`src/lib/i18n/es.json`** — acrescentar:
  - `cliente.overview.title`, `cliente.overview.subtitle`
  - `cliente.overview.kpi.companies`, `cliente.overview.kpi.scheduled`, `cliente.overview.kpi.meetings`, `cliente.overview.kpi.percentScheduled`
  - `cliente.overview.table.company`, `.location`, `.status`, `.meetings`, `.updated`
  - `cliente.overview.search.placeholder`, `cliente.overview.empty`

### Testes

- **`src/lib/__tests__/cliente-overview-kpis.test.ts`** cobrindo `computeClienteKpis`:
  1. Lista vazia → todos os campos `0`, `percentComAgendamento = 0`.
  2. 3 empresas todas com 1+ reuniões → `comAgendamento = 3`, `totalReunioes = soma`.
  3. Patológico: linha com `scheduling_status: "agendado_ok"` e `scheduled_meetings_count: 0` **não** entra em `comAgendamento`.
  4. Arredondamento: 1 de 3 com agendamento → `33`; 2 de 3 → `67`.

## Garantias

- 100% somente leitura: sem mutações, sem botões de gestão, sem export.
- Regra de bucket centralizada em `bucketGroupFromMeetings` — o invariant test existente continua válido (nenhuma reimplementação no componente nem no util — o util apenas chama o helper).
- Sem nova server function, sem migration, sem mudança de RLS.
- Testes de autorização do cliente (`cliente-read-authorization.test.ts`) continuam válidos sem alteração; o servidor segue ocultando `sem_agendamento` do `cliente`.
- Build verde e suíte verde após implementação.

## Fora de escopo

- Filtros e comportamento das abas `Empresas` e `Agendamentos`.
- Métricas de pipeline (follow-up, aprovação, cadastro incompleto) na visão do cliente.
- Alteração da regra de servidor que oculta `sem_agendamento` para `cliente`.
