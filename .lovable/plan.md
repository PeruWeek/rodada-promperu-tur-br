## Objetivo

Adicionar botão **Agendar** na aba `Inscritos` (visões `cliente`, `staff`, `admin`) para linhas com `Sem agendamento`, reutilizando o fluxo canônico de agendamento manual já existente. Reforçar a variação visual **verde** do badge `Com agendamento`. Fonte de verdade continua sendo `bucketGroupFromMeetings(profile_meetings_count)` — nenhum estado local decide o status.

## Mudanças

### 1. Novo componente reutilizável — `src/components/admin/book-for-registrant-dialog.tsx`

- Recebe `{ target: RegistrantRow | null, onClose }`.
- Usa `useServerFn(listExhibitorAvailability)` para listar expositores do evento atual, filtrando `status !== "lotada"` e `free_slots.length > 0`.
- UI em 2 passos: (1) selecionar expositor via busca por nome; (2) selecionar `free_slot`.
- Confirma via `useServerFn(bookMeetingForVisitor)` passando `{ visitorProfileId, slotId, tableId, eventId }` (o `eventId` vem do próprio `ExhibitorAvailabilityRow`, já resolvido pelo helper canônico no servidor).
- Sucesso: `toast.success` + invalida `BOOKING_INVALIDATE_KEYS` (ver item 3).
- Erros propagados (self-conflict / same-exhibitor) já vêm com mensagens amigáveis do `bookMeetingForVisitor`.

Não duplica lógica de bucket — apenas reutiliza os server functions existentes.

### 2. `src/components/admin/registrants-tab.tsx`

- Importar `CalendarPlus` (lucide) e o novo dialog.
- Estado local `bookTarget: RegistrantRow | null`.
- Badge (mantém `bucketGroupFromMeetings(count)` atual): quando `group === "com_agendamento"`, reforçar variação verde adicionando `bg-emerald-50 dark:bg-emerald-950/30` ao className existente, mantendo `border-emerald-500 text-emerald-700 dark:text-emerald-400`. Consistente com badges verdes já usados no arquivo.
- Na coluna de ações, antes do botão de agenda, renderizar quando **todas** as condições forem verdadeiras:

  ```tsx
  r.role === "visitor" &&
  (r.profile_meetings_count ?? 0) === 0 &&
  !!r.auth_user_id &&
  r.is_active === true
  ```

  ```tsx
  <Button size="sm" variant="default" onClick={() => setBookTarget(r)}>
    <CalendarPlus size={14} /> {t("admin.registrants.actions.book")}
  </Button>
  ```

  Válido para cliente, staff e admin — o `bookMeetingForVisitor` já autoriza esses três papéis via `assertOperator` no servidor.
- Renderizar `<BookForRegistrantDialog target={bookTarget} onClose={() => setBookTarget(null)} />` ao final do JSX.

### 3. Constante compartilhada — `src/lib/booking-invalidate-keys.ts` (novo)

Exporta `BOOKING_INVALIDATE_KEYS` com as chaves já usadas em `exhibitor-availability-tab.tsx`: `exhibitor-availability`, `my-agenda`, `table-agenda`, `staff-agenda`, `booking-slots`, `registrants`, `registrants-completion`, `cliente-overview-base`, `admin-companies`, `pipeline`, `pipeline-list`, `pipeline-scheduling`, `pipeline-kpis`, `pipeline-followups`, `pipeline-alerts`, `visitor-ready`.

`exhibitor-availability-tab.tsx` passa a importar essa constante (remove a cópia local) para evitar drift entre os dois pontos de agendamento manual.

### 4. i18n — `src/lib/i18n/pt-BR.json` e `es.json`

Adicionar:
- `admin.registrants.actions.book`
- `admin.registrants.book.title`, `.subtitle`, `.pickExhibitor`, `.pickSlot`, `.confirm`, `.noExhibitors`, `.searchPlaceholder`

Reaproveitar `availability.book.success` para o toast de sucesso.

## Como o status é atualizado (sem estado local)

1. Servidor: `bookMeetingForVisitor` insere `meetings.status='scheduled'` via `supabaseAdmin`. Triggers existentes recalculam `scheduled_meetings_count` / `profile_meetings_count` no pipeline.
2. Cliente: `onSuccess` invalida `BOOKING_INVALIDATE_KEYS`; `useQuery(["registrants", ...])` re-executa `listEventRegistrants`, que devolve o novo `profile_meetings_count > 0`.
3. Re-render: `bucketGroupFromMeetings(count)` retorna `"com_agendamento"` → badge verde renderiza; condição `count === 0` do botão passa a falso → botão some.

## Queries invalidadas

Todas as de `BOOKING_INVALIDATE_KEYS` — idênticas ao fluxo canônico já em produção, garantindo consistência entre Inscritos, Empresas, Visão Geral, Agenda, Disponibilidade e Pipeline.

## Reuso do fluxo atual

- Server functions: `listExhibitorAvailability` e `bookMeetingForVisitor` (mesmas guardas — conflito de horário do visitante, 1 reunião por mesa, notificação in-app + e-mail de confirmação).
- Helper de bucket: `bucketGroupFromMeetings` (fonte única já usada no badge existente).
- Constante de invalidação centralizada em `BOOKING_INVALIDATE_KEYS`.

## Arquivos alterados

- `src/components/admin/registrants-tab.tsx` — botão Agendar (com `is_active === true`), badge verde reforçado, montagem do dialog.
- `src/components/admin/book-for-registrant-dialog.tsx` — novo.
- `src/lib/booking-invalidate-keys.ts` — novo.
- `src/components/admin/exhibitor-availability-tab.tsx` — passa a importar `BOOKING_INVALIDATE_KEYS`.
- `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json` — novas chaves.

## Critérios de aceite

- Botão Agendar aparece só quando: visitante, `profile_meetings_count === 0`, `auth_user_id` presente e `is_active === true`.
- Após o primeiro sucesso, refetch de `["registrants"]` atualiza a linha, badge muda para `Com agendamento` verde e botão some — sem reload.
- Nenhuma nova regra de status: helper canônico continua sendo a fonte.
- Funciona para cliente/staff/admin (`assertOperator` já autoriza).
- Nada é tocado em `bookMeeting`/`table-agenda`/`booking-dialog`, então demais fluxos permanecem intactos.
