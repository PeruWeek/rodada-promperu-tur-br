## Objetivo

Refinar a aba `Visão geral` do perfil `cliente` em `/admin` para separar claramente empresas **Visitantes** e **Expositoras**, mantendo a tela 100% somente leitura. A regra oficial de bucket continua sendo `bucketGroupFromMeetings(scheduled_meetings_count)` em `src/lib/scheduling-status.ts` — não reimplementar em nenhum lugar.

Fonte da verdade do tipo da empresa: campo `role: "exhibitor" | "visitor"` do `RegistrantRow` retornado por `listEventRegistrants` (já existe no payload, derivado do `company_role` no backend). Nenhuma heurística textual.

## Arquivos

### Editar — `src/lib/cliente-overview.ts`

Manter `computeClienteKpis` e `formatLocation` como estão. Acrescentar:

- Estender `ClienteOverviewRow` com `role?: "visitor" | "exhibitor" | null` (campo opcional para não quebrar os testes existentes).
- Exportar `computeClienteTypeBreakdown(rows)` retornando:
  - `visitantesCount`, `expositoresCount`
  - `visitantesMeetings`, `expositoresMeetings`
  - Contagem por `r.role === "visitor"` / `"exhibitor"`; linhas com role desconhecido ficam fora dos dois buckets (não somam em nenhum lado), preservando invariante de que `visitantesCount + expositoresCount <= inscritas`.

### Editar — `src/components/admin/cliente/cliente-overview.tsx`

- Importar e usar `computeClienteTypeBreakdown`.
- Após a faixa de 4 KPIs principais, adicionar um **bloco de separação por tipo** em `grid sm:grid-cols-2 gap-3` com dois cards:
  - `Empresas visitantes` → `visitantesCount` (subtítulo pequeno com `visitantesMeetings` reuniões)
  - `Empresas expositoras` → `expositoresCount` (subtítulo pequeno com `expositoresMeetings` reuniões)
- Adicionar coluna **`Tipo`** na tabela, entre `Empresa` e `Localidade`, com badge neutro:
  - `Visitante` quando `r.role === "visitor"`
  - `Expositor` quando `r.role === "exhibitor"`
  - `—` caso ausente
- Ajustar `colSpan` do estado vazio para refletir o número correto de colunas (`hasUpdatedAt ? 6 : 5`).
- Manter: busca por nome, filtro de status oculto enquanto houver apenas um bucket, badge de status via `bucketGroupFromMeetings`, ordenação por `company_trade_name`, coluna `Última atualização` apenas se algum row trouxer `updated_at` / `pipeline_updated_at`.
- Continua sem mutações, sem export, sem ações por linha.

### Editar — `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json`

Acrescentar ao bloco já existente `cliente.overview`:

- `kpi.visitors` = `Empresas visitantes` / `Empresas visitantes`
- `kpi.exhibitors` = `Empresas expositoras` / `Empresas expositoras`
- `kpi.visitorMeetings` = `Reuniões de visitantes` / `Reuniones de visitantes`
- `kpi.exhibitorMeetings` = `Reuniões de expositores` / `Reuniones de expositores`
- `table.type` = `Tipo` / `Tipo`
- `type.visitor` = `Visitante` / `Visitante`
- `type.exhibitor` = `Expositor` / `Expositor`

(Demais chaves já existem.)

### Sem alterações

- `src/routes/_authenticated/admin.tsx` (a aba `overview` já está registrada como padrão para `isClienteOnly`).
- `src/lib/staff-exports.functions.ts` (campo `role` já presente no payload).
- `src/lib/scheduling-status.ts`.
- Servidor, RLS, migrations.

### Testes — estender `src/lib/__tests__/cliente-overview-kpis.test.ts`

Adicionar bloco `describe("computeClienteTypeBreakdown")` cobrindo:

1. Lista vazia → todos os contadores 0.
2. Mix 2 visitantes + 1 expositor → contagens corretas e somas de reuniões corretas por tipo.
3. Linha com `role` ausente não soma em nenhum bucket; `visitantesCount + expositoresCount <= inscritas`.
4. Soma `visitantesMeetings + expositoresMeetings` bate com `totalReunioes` quando todas as linhas têm `role` definido.

Os testes existentes de `computeClienteKpis` e `formatLocation` permanecem válidos.

## Garantias

- 100% somente leitura, sem nova server function, sem migration, sem mudança de RLS.
- Tipo derivado exclusivamente do `role` oficial do payload — sem heurística por nome.
- Bucket de agendamento continua exclusivamente por `bucketGroupFromMeetings(scheduled_meetings_count)`; o invariant test atual permanece válido.
- Abas `Empresas` e `Agendamentos` inalteradas.

## Fora de escopo

- Filtros/comportamento das demais abas.
- Métricas de pipeline (follow-up, aprovação, cadastro incompleto).
- Alteração da regra de servidor que oculta `sem_agendamento` para `cliente`.
