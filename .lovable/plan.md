
# Credenciamento → Sala de Operação da Rodada

Preserva integralmente o fluxo atual de **Chegadas** (`busca + lista + Marcar chegada`), que abre como sub-aba padrão e vira `<ArrivalsPanel />` sem mudança de comportamento. Adiciona três sub-abas em cima dos mesmos dados. UX rápida, auditável, no máximo 1 ação primária + 1 secundária por linha.

## 1. Estrutura da tela

```text
[ Chegadas (default) ] [ Ao vivo ] [ Encaixe ] [ Pós-evento ]
```

- **Chegadas** — `<ArrivalsPanel />`: comportamento idêntico ao de hoje; abre por padrão.
- **Ao vivo** — faixa de 5 KPIs (polling 30 s) + lista filtrada pelo KPI selecionado.
- **Encaixe** — fila de pareamento com confirmação em 1 clique.
- **Pós-evento** — read-only + CSV.

## 2. KPIs ao vivo (polling 30 s, cada KPI filtra a lista)

Calculados a partir de `general_checkins`, `meetings`, `meeting_checkins`, `time_slots`, `event_tables`:

- **Presentes agora** — `count(distinct profile_id)` em `general_checkins` por `event_id`.
- **Em reunião agora** — `meetings.status='scheduled'` cujo `time_slot` cobre `now()`.
- **Ociosos agora** — presentes com role `visitor|exhibitor` sem `meeting scheduled` no slot corrente.
- **Reuniões em risco** — `scheduled` com `slot.start_at < now() - 5 min` e sem `meeting_checkins`.
- **Mesas livres no bloco** — `event_tables` ativas − mesas com reunião `scheduled` no slot corrente.

## 3. Encaixe

- Base: visitantes ociosos × mesas livres no slot atual, filtrados por `available_for_fillin=true`.
- Ordenação: matching simples segmentos/interesses × serviços; fallback alfabético.
- 1 clique reaproveita **exatamente** o caminho existente de booking (mesmas travas `slot × table × visitor`). Sem bypass.
- Telemetria `is_fillin=true` via `context` do `audit_logs`. Sem coluna nova em `meetings`.

## 4. Pós-evento (read-only + CSV)

Consolida a edição por participante. Sem ações operacionais.

Colunas mínimas do CSV: `empresa`, `participante`, `perfil`, `presença`, `reuniões agendadas`, `reuniões realizadas`, `no-show`, `atraso médio`, `mesa`, `bloco`.

## 5. Campos mínimos (aditivos, defaults preservam comportamento)

### `general_checkins`
- `source text default 'staff_manual'` — origem operacional (`entrance | staff_manual | qr | self`).
- `note text null` — observação curta (≤ 140 char), sob demanda.
- `available_for_fillin boolean default true` — toggle rápido no card.

### `meeting_checkins`
- `note text null`.
- `late_minutes` já existe → auto-cálculo `now() - slot.start_at` quando staff marca `status='present'` após o início; editável.

Sem novos campos em `meetings` / `event_tables`. Toda a leitura operacional é derivada.

## 6. Server functions (admin/staff)

Em `src/lib/checkin.functions.ts`:

- `getLiveOperations({ eventId })` → `{ slotCurrent, slotNext, presentProfiles, inMeetingProfiles, idleProfiles, atRiskMeetings, freeTables, kpis }`.
- `suggestFillins({ eventId, slotId })` → pares ordenados `{ visitor, table, exhibitor, score }`.
- `setAvailableForFillin({ checkinId, value })`.
- `setCheckinNote({ checkinId, note })`.
- `undoGeneralCheckIn({ checkinId })` — admin apenas.

`generalCheckIn` e `meetingCheckIn` mantêm contrato. `meetingCheckIn` ganha só o auto-cálculo de `late_minutes` quando `status='present'`.

Toda mutação (check-in, no-show, encaixe, undo, notas, toggle) grava em `audit_logs` com `actor_profile_id` e `context={ eventId, slotId, kind }`.

## 7. UI

- `src/routes/_authenticated/admin.tsx` — `CheckinTab` vira wrapper de sub-abas (default `Chegadas`); corpo atual extraído para `<ArrivalsPanel />`.
- Novos componentes em `src/components/admin/checkin/`:
  - `kpi-strip.tsx` — 5 KPIs clicáveis.
  - `live-ops-panel.tsx` — KPIs + lista filtrada.
  - `fillin-queue.tsx` — sugestões e confirmação.
  - `postevent-summary.tsx` — read-only + botão CSV.
- i18n: novas chaves `admin.checkin.live.*`, `admin.checkin.fillin.*`, `admin.checkin.post.*`, `admin.checkin.kpi.*` (pt-BR + es).

## 8. Fora de escopo

Websocket/realtime, QR nativo, reagendamento automático, mudanças em pipeline/aprovação/slots além do necessário.

## Critérios de aceite

- "Chegadas" idêntica ao comportamento atual e abre como sub-aba padrão.
- "Ao vivo" mostra 5 KPIs corretos com polling 30 s; cada KPI filtra a lista.
- "Encaixe" cria a reunião em 1 clique reaproveitando as travas de conflito existentes (sem bypass).
- "Pós-evento" é read-only e exporta CSV com as colunas mínimas listadas.
- Undo de chegada só admin; tudo em `audit_logs`.
- Sem campos novos preenchidos, o sistema continua funcionando (defaults cobrem).
