## Objetivo
Nova aba admin **"Histórico de perdas"** — visão read-only que mostra reuniões canceladas por dedupe/conflito com a "vencedora" do mesmo `table_id + slot_id`. Não restaura, não altera motor de agendamento.

## Garantia de isolamento (regra dura)
Proibido alterar:
- `src/lib/booking.functions.ts`, `exhibitor-availability.functions.ts`, `dedupe-recovery.functions.ts`
- `booking-dialog.tsx`, `book-for-registrant-dialog.tsx`, `dedupe-recovery-tab.tsx`, demais abas atuais
- qualquer trigger, índice, RPC de dedupe, `auto-sanitize`, migrations existentes
- RLS, roles, dependências

Permitido: 2 arquivos novos + 1 `TabsTrigger`/`TabsContent` no bloco admin de `admin.tsx` + strings em `i18n/pt-BR.json` e `es.json`. Zero migration.

## Arquivos
```
src/lib/lost-bookings.functions.ts            (new — server-fn admin-only, read-only)
src/components/admin/lost-bookings-tab.tsx    (new — UI: filtros, tabela, agregação por empresa)
src/routes/_authenticated/admin.tsx           (add: 1 TabsTrigger + 1 TabsContent, admin-only)
src/lib/i18n/pt-BR.json                        (add strings)
src/lib/i18n/es.json                           (add strings)
```

## Fonte de dados
Somente leitura de `meetings`, `time_slots`, `event_tables`, `profiles`, `companies`, `audit_logs`. Nenhuma tabela nova.

### `listLostBookings` (server-fn admin-only, evento ativo)
Entrada opcional: `eventId`, `companyId`, `profileId`, `reason` (multi), `dateFrom`, `dateTo`, `groupBy: 'contact' | 'company'` (default `contact`), `limit` (default 500, máx 2000).

Algoritmo:
1. **Perdedoras** — `meetings` do evento com `status = 'cancelled'` e `cancel_reason` em:
   - `admin_dedupe_table_slot_company`
   - `auto-sanitize:duplicate_table_slot_different_company`
   - qualquer `auto-sanitize:*` (bucket "outro motivo técnico")
2. **Vencedora histórica por `(table_id, slot_id)`** — sem usar `meetings.updated_at`:
   - Universo: reuniões com o mesmo `table_id + slot_id` e `status IN ('scheduled','done','no_show')`.
   - Regra: a mais antiga que **permaneceu válida** no conflito = `MIN(created_at)` entre esse universo, com `created_at <= loser.created_at` quando existir candidata anterior; caso contrário, a `MIN(created_at)` do universo (a "sobrevivente" pode ter sido criada depois quando a perdedora foi cancelada por auto-sanitize; mantemos a mais antiga viva como vencedora canônica).
   - **Reforço via `audit_logs`**: buscar `action='admin_dedupe_table_slot_company'` ou similar com payload citando o mesmo `table_id + slot_id` e/ou `meeting_id` da perdedora; se o log referenciar uma `winner_meeting_id` / `kept_meeting_id`, esse ID sobrescreve a heurística de `MIN(created_at)`. Log ausente → cai na heurística; log presente e consistente → marca `winner_source: 'audit_log'` (senão `'min_created_at'`).
   - Se nenhuma candidata viva existir, `winner = null` e `loss_source = "Outro motivo técnico"`.
3. JOIN em `time_slots` (start_at/end_at), `event_tables` (table_number), `profiles` (loser + winner) e `companies`.
4. `loss_source`:
   - `admin_dedupe_table_slot_company` → "Dedupe manual/admin"
   - `auto-sanitize:duplicate_table_slot_different_company` → "Auto-sanitize (outra empresa)"
   - vencedora identificada com `created_at < loser.created_at` → "Perdeu para outra empresa (chegou antes)"
   - resto → "Outro motivo técnico"
5. Ordena por `cancelled_at desc` (default) ou `impact desc` (agrupado).
6. **Paginação/truncamento**: aplica `limit` ao final e retorna:
   ```ts
   { rows, by_company, total_found, truncated: total_found > rows.length, limit }
   ```

Saída por item:
```ts
{
  meeting_id, cancelled_at, cancel_reason, loss_source,
  loser: { profile_id, full_name, email, company_id, company_trade_name },
  slot: { table_id, table_number, slot_id, start_at, end_at },
  winner: {
    meeting_id, created_at, status,           // status ∈ scheduled|done|no_show
    profile_id, full_name, company_id, company_trade_name,
    winner_source: 'audit_log' | 'min_created_at'
  } | null,
}
```

## UI (`lost-bookings-tab.tsx`)
Aba `TabsTrigger value="lostBookings"` só no bloco admin.

- Filtros: empresa (search), contato (search), motivo (multi-check), intervalo de data (cancelamento)
- Toggle "Por contato | Por empresa"
- Tabela por contato: Contato · Empresa · Email · Mesa · Horário perdido · Cancelado em · Motivo · Empresa vencedora · Contato vencedor · Status da vencedora · Criada em (vencedora) · Fonte (`audit_log`/`heurística`) · Ação
- Tabela por empresa: Empresa · Contatos impactados · Perdas totais · Breakdown por motivo · Última perda
- Ordenação: "Mais recente" (default) / "Maior impacto"
- **Banner de truncamento** quando `truncated=true`: "Mostrando X de Y — refine os filtros ou aumente o limite."
- Ação por item: **"Abrir reacomodação"** — apenas navega para a aba `dedupeRecovery` com `profileId` pré-selecionado. Nenhuma escrita.
- Vazio: mensagem operacional. Erro: toast amigável, nunca `error.message` cru.

## Validação obrigatória após implementação
1. `git diff --stat` provando zero mudança nos arquivos protegidos e migrations.
2. `admin.tsx` recebe apenas 1 `TabsTrigger` + 1 `TabsContent` novos.
3. Suíte de testes intacta e verde.
4. Nenhum arquivo novo em `supabase/migrations/`.
5. Exemplos reais consultados via `supabase--read_query`:
   - ≥1 caso da **Ambiental Travel Experience** com vencedora resolvida (via `audit_log` quando disponível, senão `min_created_at`).
   - ≥1 caso da **Top Service** idem.
   Todos os campos preenchidos, incluindo `winner.status` e `winner_source`.
6. Verificar que ao menos 1 caso resolveu via `winner_source='audit_log'` e ao menos 1 via `min_created_at`, provando os dois caminhos.

## Critérios de aceite
- Aba nova só para admin; nenhuma tela existente afetada.
- Resolução da vencedora **não usa `meetings.updated_at`** em nenhum ponto.
- Vencedora considera `status ∈ (scheduled, done, no_show)`.
- `audit_logs` reforça o vínculo quando disponível; heurística `MIN(created_at)` é fallback.
- Payload sempre retorna `total_found` + `truncated`.
- Botão "Abrir reacomodação" apenas navega — não grava nada.
- Fluxos de booking e aba "Reacomodação" permanecem byte-a-byte idênticos.
