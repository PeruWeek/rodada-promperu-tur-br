## Objetivo

Blindar o cancelamento: **todo cancelamento que passa pelos fluxos canônicos da aplicação via `performMeetingCancellation`** produz automaticamente (a) uma linha em `audit_logs` com ator + origem e (b) um alerta operacional em `notifications` para admins, sem duplicar lógica em cada caller.

Triggers e migrations que setam `status='cancelled'` diretamente no banco (por exemplo dedupe `admin_dedupe_table_slot_company` e `auto-sanitize:duplicate_table_slot_different_company`) **continuam fora do helper nesta rodada**. Eles já deixam trilha pelo próprio `cancel_reason` e o enum de origem reserva `system_dedupe` / `system_sanitize` para uso futuro caso passem a chamar o helper.

## Onde a canônica vive hoje

`src/lib/booking.server.ts` → `performMeetingCancellation` é o único ponto que os fluxos de UI usam para gravar `status='cancelled'`. Callers:

- `src/lib/booking.functions.ts` → `cancelMeeting` (visitante)
- `src/lib/booking.functions.ts` → `adminCancelMeeting` (admin unitário)
- `src/lib/booking.functions.ts` → `adminCancelVisitorFutureMeetings` (admin, cancelar futuras)

Exceção pontual que vamos alinhar: `src/lib/admin-auth.functions.ts` → `cancelFutureMeetingsForRegistrant` (inativação de registrant) faz `UPDATE ... IN (...)` em lote e escreve seu próprio audit. Vai passar a chamar o helper em loop com `origin='admin_deactivation'`, para não existir mais caminho paralelo de UI.

## Contrato do helper (nova assinatura)

```ts
type CancellationOrigin =
  | "visitor_self"
  | "admin_manual"
  | "admin_cancel_all_future"
  | "admin_deactivation"
  | "system_dedupe"
  | "system_sanitize"
  | "system_other";

type CancellationActorType = "visitor" | "admin" | "system";

performMeetingCancellation(input: {
  meetingId: string;
  reason?: string | null;
  cancellingProfile: CancellingProfile;   // já existe
  visitorScope?: string;                  // já existe
  origin: CancellationOrigin;             // NOVO — obrigatório
  actorType: CancellationActorType;       // NOVO — obrigatório
  actorProfileId?: string | null;         // NOVO — default = cancellingProfile.id
})
```

Todos os callers explicitam `origin` + `actorType`. Nenhum default silencioso.

## Novos side-effects (dentro do próprio helper, best-effort)

Depois do UPDATE bem-sucedido, além do que já faz hoje:

### 1. `audit_logs` — action canônica única

- `action = "meeting.cancelled"`
- `event_id = updated.event_id`
- `actor_profile_id = actorProfileId ?? cancellingProfile.id` (só pode ser `null` quando `actorType='system'`)
- `payload`:
  ```json
  {
    "meeting_id": "...",
    "event_id": "...",
    "table_id": "...",
    "slot_id": "...",
    "visitor_profile_id": "...",
    "exhibitor_profile_id": "...",
    "actor_type": "visitor|admin|system",
    "actor_profile_id": "...",
    "actor_name": "...",
    "origin": "visitor_self|admin_manual|...",
    "cancel_reason": "...",
    "slot_start": "...",
    "slot_end": "...",
    "table_number": 9,
    "cancelled_at": "ISO"
  }
  ```

O `writeAdminCancelAuditLog` em `booking.functions.ts` deixa de existir (redundante). O audit-resumo por evento de `cancelFutureMeetingsForRegistrant` (`registrant.deactivated.meetings_cancelled`) continua como sumário do processo, mas cada meeting individual passa a ter sua linha `meeting.cancelled`. Assim `meeting.cancelled` vira a fonte única **por reunião**.

### 2. `notifications` — alerta operacional para admins (complemento, não substituto da UI)

Reaproveita `type=meeting_cancelled`. Insere N linhas (uma por admin) buscando destinatários por:

```
select p.id from profiles p
join user_roles ur on ur.user_id = p.auth_user_id
where ur.role = 'admin'
```

Cada linha:
- `recipient_profile_id = <admin profile id>`
- `type = 'meeting_cancelled'`, `channel = 'in_app'`, `status = 'sent'`
- `title = "Cancelamento — <origem legível>"`
- `body`: quem cancelou, visitante + empresa, expositor + mesa, horário, motivo
- `data`: `{ audience: 'admin_ops', origin, actor_type, actor_profile_id, actor_name, meeting_id, visitor_profile_id, visitor_name, visitor_company, exhibitor_profile_id, exhibitor_company, table_id, table_number, slot_id, slot_start, slot_end, cancel_reason, cancelled_at }`

Marcador `data.audience='admin_ops'` diferencia dos alertas ao expositor. Fica gravado para uma UI de notifications futura — mas **como ainda não existe UI própria de notifications, essa entrega sozinha não é considerada visível**. A superfície visível obrigatória desta rodada é a `AuditTab`.

E-mail operacional para admins fica de fora nesta rodada (exigiria novo template SendGrid).

## Callers ajustados

| Arquivo / função | origin | actorType |
|---|---|---|
| `booking.functions.ts` → `cancelMeeting` | `visitor_self` | `visitor` |
| `booking.functions.ts` → `adminCancelMeeting` | `admin_manual` | `admin` |
| `booking.functions.ts` → `adminCancelVisitorFutureMeetings` (loop) | `admin_cancel_all_future` | `admin` |
| `admin-auth.functions.ts` → `cancelFutureMeetingsForRegistrant` (agora em loop) | `admin_deactivation` | `admin` |

## Superfície de visibilidade operacional obrigatória — `AuditTab`

`src/components/admin/audit-tab.tsx` passa a ser **a superfície mínima obrigatória de alerta operacional** nesta rodada. Mudanças:

- Adicionar `"meeting.cancelled": "Reunião cancelada"` em `ACTION_LABELS`.
- Adicionar entrada dedicada em `FILTER_OPTIONS` (`{ value: "meeting.cancelled", label: "Reunião cancelada" }`) — filtro dedicado.
- Ao renderizar uma linha `meeting.cancelled`, exibir de forma destacada, a partir do `payload`:
  - `origin` (badge, rótulo em pt-BR: "Visitante", "Admin — manual", "Admin — futuras", "Admin — inativação", "Sistema — dedupe", etc.)
  - `actor_type` (badge)
  - `actor_name`
  - `cancel_reason` (texto completo, com fallback "—")
  - visitante: `visitor_name` + `visitor_company` (com fallback para `visitor_profile_id` se ausente)
  - mesa: `table_number` (com fallback `table_id`)
  - `slot_start` formatado em `America/Sao_Paulo`
  - `cancelled_at` (ou `created_at` da linha) formatado
- Nada de novo componente global (bell/toast) — a `AuditTab` já é onde admins vão olhar hoje.

Notifications continuam sendo gravadas em paralelo (para futura UI própria), mas a entrega visível desta rodada é a `AuditTab`.

## Fora do escopo

- Alterar triggers/migrations que cancelam direto no banco.
- Novo template de e-mail operacional.
- Bell/toast em tempo real.
- Booking, disponibilidade, reminders, exports.

## Arquivos alterados

- `src/lib/booking.server.ts` — assinatura, audit + fanout admin
- `src/lib/booking.functions.ts` — 3 callers passam origem; remove `writeAdminCancelAuditLog`
- `src/lib/admin-auth.functions.ts` — `cancelFutureMeetingsForRegistrant` chama o helper em loop
- `src/components/admin/audit-tab.tsx` — filtro + rótulo + renderização enriquecida para `meeting.cancelled`

## Evidências que vou entregar

- diff de `performMeetingCancellation` (assinatura + audit + fanout admin)
- diff da `AuditTab` (filtro dedicado + campos destacados)
- lista dos 4 callers e a origem que cada um passa
- action final: `meeting.cancelled`
- exemplo real de payload em `audit_logs` para `visitor_self`, `admin_manual` e `admin_deactivation` (via `supabase--read_query`)
- exemplo real de linha em `notifications` com `data.audience='admin_ops'`
- screenshot/descrição da `AuditTab` filtrada por `meeting.cancelled` mostrando origem, ator, visitante, mesa e horário
- validação final: cancelar 1 reunião como visitante e outra como admin, confirmar as duas linhas em `audit_logs` e vê-las na `AuditTab`

## Critérios de aceite

- todo cancelamento **que passa pelos fluxos canônicos via `performMeetingCancellation`** produz linha `meeting.cancelled` em `audit_logs` com `origin` e `actor_type`
- todo cancelamento nesse caminho produz N linhas em `notifications` (`audience='admin_ops'`) — uma por admin
- notificação atual ao expositor continua intacta
- nenhum caller de UI escreve `status='cancelled'` fora de `performMeetingCancellation`
- triggers/migrations que cancelam direto no banco seguem fora do helper nesta rodada, com o enum já reservado para elas
- possível distinguir visitor_self / admin_manual / admin_cancel_all_future / admin_deactivation por `payload.origin`
- `AuditTab` mostra filtro dedicado para `meeting.cancelled` e renderiza origem, ator, motivo, visitante, mesa e horário sem depender de outra UI
- sem regressão nos fluxos existentes
