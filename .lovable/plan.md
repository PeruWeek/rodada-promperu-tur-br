## Nova aba: Disponibilidade Expositoras (APROVADO — revisão final)

Aba operacional no `/admin` para `admin`, `staff` e `cliente` verem disponibilidade das mesas expositoras, horários livres e agendarem manualmente inscritos visitantes.

### Arquivos a criar

- **`src/lib/exhibitor-availability.functions.ts`**
  - `listExhibitorAvailability({ eventId? })` — uma linha por `company_id` (consolidando múltiplas mesas), com: `trade_name`, `city`, `country_code`, `tables[]`, `slots_total`, `slots_booked`, `slots_free`, `status` (`sem_mesa` | `lotada` | `com_agendamento` | `sem_agendamento` — via `bucketGroupFromMeetings`), `free_slots[]`, `booked_slots[]`. Autorização: `admin | staff | cliente` (`getPrimaryRoleServer`).
    - **Resolução do evento atual:** reutiliza o helper canônico do projeto — `getCurrentEventIdWith(supabaseAdmin, data.eventId)` (o mesmo importado/definido em `src/lib/staff-exports.functions.ts` e já usado por `listEventRegistrants`, `cliente-overview` etc.). Nenhuma heurística nova de "mais recente = atual"; se o projeto mudar a regra de current event, esta aba herda automaticamente.
    - Fetch em lote, sem N+1.
  - `bookMeetingForVisitor({ visitorProfileId, slotId, tableId, eventId })` — **reaplica integralmente** as guardas do `bookMeeting`:
    1. Slot alvo existe;
    2. Conflito por `start_at` do visitante em qualquer mesa (`meetings` + join `time_slots`);
    3. Unique visitor/table scheduled.
    Insert via `supabaseAdmin` com `visitor_profile_id = alvo`. Trigger `enforce_meeting_no_conflict` + índice `uq_meetings_visitor_table_scheduled` permanecem garantia dura.
    **Efeitos colaterais idênticos ao `bookMeeting`**, wording literal:
    - Notification `type: "meeting_created"`, `title: "Nova reunião agendada"`, `body: "${company_trade_name ?? visitor.full_name} agendou uma reunião com você."`
    - E-mail `meeting-confirmation` com exatamente os mesmos campos (`language`, `visitorName`, `exhibitorCompany`, `tableNumber`, `slotStart`, `slotEnd`, `agendaUrl: "https://rodada.promperu.tur.br/agenda"`) e `idempotencyKey: meeting-confirm-<id>`.

- **`src/components/admin/exhibitor-availability-tab.tsx`**
  - KPIs: total expositoras · com agendamento · com vaga · total slots livres.
  - Filtros: busca por nome + select de status (`todas | com_agendamento | sem_agendamento | com_vaga | lotada | sem_mesa`).
  - Ordenação (servidor): com vaga → sem agendamento → lotada → sem mesa; alfabético como tie-breaker.
  - Cada card: `trade_name`, mesa(s) (`table_numbers_label`), cidade/país, badges, 3 próximos slots livres inline + "ver todos".
  - Ações por linha: `Ver horários` (drawer com todos slots · Livre/Ocupado + visitor_name) · `Agendar visitante` (abre `ManualBookingDialog`).
  - `ManualBookingDialog`: combobox alimentado por `listEventRegistrants({ role: "visitor", unrestrictedCliente: true })` — **sem `eventId` explícito**, o servidor resolve pelo mesmo helper canônico (garantindo somente visitantes do evento atual). Select de slot livre (default = o clicado). Confirma → `bookMeetingForVisitor`.
  - Após sucesso: `queryClient.invalidateQueries` para cada key **confirmada por varredura**:
    - `["exhibitor-availability"]`
    - `["my-agenda"]` · `["table-agenda"]` · `["staff-agenda"]`
    - `["booking-slots"]`
    - `["registrants"]` · `["registrants-completion"]`
    - `["cliente-overview-base"]`
    - `["admin-companies"]`
    - `["pipeline"]` · `["pipeline-list"]` · `["pipeline-scheduling"]` · `["pipeline-kpis"]` · `["pipeline-followups"]` · `["pipeline-alerts"]`
    - `["visitor-ready"]`

### Arquivos a alterar

- `src/routes/_authenticated/admin.tsx` — `<TabsTrigger value="availability">` + `<TabsContent>` nas 3 árvores (admin, staff, cliente).
- `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json` — chave `admin.tabs.availability` + bloco `availability.*` (kpis, filtros, status, dialog).

### Testes

- `src/lib/__tests__/exhibitor-availability.test.ts`:
  - consolidação de múltiplas mesas em 1 linha por `company_id`;
  - `slots_free = total − scheduled`;
  - transições de status (`sem_mesa` / `lotada` / `sem_agendamento` / `com_agendamento`);
  - guardas reaplicadas em `bookMeetingForVisitor`;
  - autorização (visitor bloqueado; cliente permitido).

### Checklist honrado

1. `bookMeetingForVisitor` reaplica integralmente guardas + mensagens + efeitos do `bookMeeting`.
2. Linha única por `company_id`, sem duplicar expositora.
3. Invalidação usa apenas keys existentes no projeto.
4. Seletor restrito ao evento atual (via helper canônico do servidor, sem `eventId` no cliente).
5. Evento atual sempre resolvido pelo helper canônico já adotado (`getCurrentEventIdWith`), não por heurística própria.

### Entregáveis finais

1. arquivos criados/alterados; 2. resumo; 3. cálculo de disponibilidade; 4. permissões; 5. reuso do manual booking; 6. seletor restrito ao evento atual; 7. pontos p/ validação manual.
