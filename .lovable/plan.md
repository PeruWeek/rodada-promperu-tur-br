## Objetivo
Tela admin **NOVA e ISOLADA** para reacomodar contatos impactados por dedupe (perderam reuniões pela regra `1 slot = 1 empresa`), sem tocar em trigger, índice, dedupe, lotação, disponibilidade ou fluxo de booking existente.

## Garantia de isolamento (regra dura)
Proibido alterar:
- `src/lib/booking.functions.ts`
- `src/lib/exhibitor-availability.functions.ts`
- `src/components/booking-dialog.tsx`
- `src/components/admin/book-for-registrant-dialog.tsx`
- `src/components/admin/registrants-tab.tsx`, `exhibitor-availability-tab.tsx` e demais abas atuais
- qualquer migration existente (triggers, índices, RPC `admin_dedupe_table_slot_company`, `auto-sanitize`)

Permitido:
- criar 2 arquivos novos
- adicionar 1 `TabsTrigger` + 1 `TabsContent` **somente no bloco admin** de `src/routes/_authenticated/admin.tsx`
- adicionar strings em `i18n/pt-BR.json` e `es.json`

Nenhuma migration nova. Nenhuma alteração de RLS. Nenhuma alteração de dependências.

## Escopo

### 1. `listDedupeImpacted` (default `mode='urgent'`)
Server-fn admin-only, evento ativo. Retorna por contato:
- `profile_id`, `full_name`, `email`, `company_id`, `company_trade_name`
- `scheduled_count`, `total_history`
- `cancelled_by_dedupe` (`cancel_reason` in `admin_dedupe_table_slot_company`, `auto-sanitize:duplicate_table_slot_different_company`)

Filtros:
- `urgent` (default): `scheduled_count = 1 AND total_history > 1 AND cancelled_by_dedupe > 0`
- `all`: qualquer `cancelled_by_dedupe > 0`

Ordena por `cancelled_by_dedupe desc, total_history desc`. Também expõe agregação por empresa.

### 2. `suggestRecoverySlots(profile_id)`
Slots viáveis priorizados:
1. **Same-company** — slot já ocupado por colega da mesma empresa, sem conflito de horário nem duplicidade de mesa para o contato.
2. **Livres** — slot totalmente livre, sem outra empresa no slot, sem conflito pessoal, sem já ter reunião na mesa.

Somente leitura.

### 3. `rebookImpacted` — auditoria pós-fato com status claro
Nunca grava sucesso antes de acontecer.

1. Chama `bookForRegistrant({...})`.
2. Sucesso → `audit_logs` `action='dedupe_recovery_rebook'`, payload `{ status: 'succeeded', profile_id, meeting_id, target_table_id, target_slot_id, source, prior_cancelled_by_dedupe }`. Retorna `{ ok: true, meetingId }`.
3. Erro → `audit_logs` mesmo `action`, payload `{ status: 'failed', profile_id, target_table_id, target_slot_id, source, error_code, error_message }`. Retorna `{ ok: false, code, friendlyMessage }` (não relança).

Mapeamento `error_message → code`:
- "outra empresa" / "one_company_per_slot" → `SLOT_TAKEN_OTHER_COMPANY`
- "já tem reunião" no mesmo horário → `VISITOR_TIME_CONFLICT`
- "no máximo 1 reunião por mesa" → `DUPLICATE_TABLE`
- "Conflito" genérico → `SLOT_CONFLICT`
- resto → `UNKNOWN`

Detalhe técnico só em `audit_logs`.

### 4. UX de erro amigável (pt-BR)
- `SLOT_TAKEN_OTHER_COMPANY`: "Este horário acabou de ser ocupado por outra empresa. Escolha outro slot sugerido."
- `VISITOR_TIME_CONFLICT`: "O contato já tem uma reunião em outro expositor neste horário."
- `DUPLICATE_TABLE`: "O contato já possui reunião com esta mesa."
- `SLOT_CONFLICT`: "Este horário deixou de estar disponível. Recarregue as sugestões."
- `UNKNOWN`: "Não foi possível reagendar. A ação foi registrada; tente outro slot."

Componente nunca renderiza `error.message` cru. Após falha, refaz `suggestRecoverySlots`.

### 5. UI
`TabsTrigger value="dedupeRecovery"` só no bloco admin de `admin.tsx`. Conteúdo:
- Toggle "Urgentes (padrão) | Todos"
- Toggle "Por contato | Por empresa"
- Tabela: Contato · Empresa · Email · Scheduled · Total · Canceladas por dedupe · Ação "Reacomodar"
- Drawer com sugestões (badge "mesma empresa" antes de "livre"), botão "Reagendar" por linha
- Sucesso: toast + invalidação de queries próprias
- Falha: toast amigável + refresh das sugestões

## Validação obrigatória após implementação
Vou reportar explicitamente:

1. **Booking do visitante inalterado** — abrir `booking-dialog.tsx` num expositor com colega da mesma empresa e confirmar que:
   - slot `same_company` continua selecionável com o mesmo rótulo
   - slot `other_company` continua bloqueado
   - agendamento normal ainda passa por `bookMeeting`
   `git diff --stat` deve mostrar zero mudança em `booking-dialog.tsx` e `booking.functions.ts`.

2. **Admin normal inalterado** — abrir `book-for-registrant-dialog.tsx` e a aba Registrantes/Agendamentos, confirmar comportamento idêntico. `git diff --stat` deve mostrar zero mudança nesses arquivos.

3. **Nova aba só adiciona** — `admin.tsx` recebe apenas 1 `TabsTrigger` + 1 `TabsContent` novos no bloco admin; nenhum trigger/content existente removido ou renomeado.

4. **Lista exata de arquivos alterados** ao final, com contagem `+add/-del`:
   ```
   src/lib/dedupe-recovery.functions.ts           (new)
   src/components/admin/dedupe-recovery-tab.tsx   (new)
   src/routes/_authenticated/admin.tsx            (add tab only)
   src/lib/i18n/pt-BR.json                        (add strings)
   src/lib/i18n/es.json                           (add strings)
   ```
   Qualquer arquivo fora dessa lista = regressão, abortar.

5. **Suite de testes** (`src/lib/__tests__/*`) executada intacta e verde.

6. **Sem migration** — `supabase/migrations/` sem novos arquivos.

## Critérios de aceite
- Default carrega apenas casos urgentes (`scheduled=1 AND total>1`) — os 7 contatos já identificados.
- Modo "Todos" também mostra impactados com ≥2 reuniões restantes.
- Para Juliana, drawer oferece os slots same-company da Carla (13:45, 16:00, 16:15, 16:30, 16:45).
- Reagendamento sempre via `bookForRegistrant`; auditoria com `status: succeeded|failed` correspondendo ao resultado real.
- Falha nunca mostra erro cru; admin vê mensagem operacional; detalhe técnico só em `audit_logs`.
- Fluxos de booking (visitante e admin) permanecem byte-a-byte idênticos.
