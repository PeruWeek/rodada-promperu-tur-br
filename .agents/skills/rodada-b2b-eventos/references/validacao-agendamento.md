# Validação do processo de agendamento (ponta a ponta)

Use este reference quando o pedido for **auditar, validar ou destravar** o processo de agendamento — antes do go-live, na véspera, ou após relato de bug em produção. Específico para a stack deste projeto (tabelas `events`, `event_tables`, `time_slots`, `meetings`, `meeting_reschedules`, `meeting_checkins`, `meeting_outcomes`, `staff_table_assignments`, `general_checkins`, `exhibitor_requests`, `exhibitor_profiles`, `visitor_profiles`, `companies`, `audit_logs`, `email_send_state`).

Para cada fase: **o que validar / como testar / sinal de falha / correção**.

## Fase 1 — Configuração do evento

- **Validar**: existe 1 evento ativo na janela correta; fuso horário coerente; duração de slot + buffer + pausas definidos ANTES de gerar `time_slots`; mesas numeradas sem buracos nem duplicatas.
- **Como testar**: `SELECT * FROM events WHERE is_active`; conferir `event_tables` (count, números sequenciais); confirmar que `rebuild_event_time_slots` foi rodado após a última alteração de horário.
- **Falha típica**: `time_slots` antigos sobrando após mudança de duração → reservas em horário inexistente na agenda visível.
- **Correção**: rodar `rebuild_event_time_slots(event_id)` e validar contagem antes/depois; migrar reservas órfãs ou cancelar com comunicação.

## Fase 2 — Cadastro e elegibilidade

- **Validar**: expositor tem `companies` + `exhibitor_profiles` completos + mesa atribuída (`event_tables.exhibitor_profile_id`). Visitante tem `companies` + `visitor_profiles` com interesses/segmentos preenchidos. `exhibitor_requests` aprovados antes de virar expositor.
- **Como testar**: rodar as queries de auditoria abaixo (mesas sem expositor / expositores sem mesa / perfis incompletos).
- **Falha típica**: expositor aprovado sem mesa → não aparece na busca dos visitantes.
- **Correção**: alocar mesa ou desativar perfil; nunca deixar expositor "fantasma".

## Fase 3 — Matching e abertura de agenda

- **Validar**: critérios de priorização explícitos e documentados (interesse > setor > porte > região); limites por pessoa configurados (máx. N reuniões); sem par duplicado; sem concorrentes sem opt-in; `/explore` só mostra slots de mesas com expositor ativo dentro da janela.
- **Como testar**: logar como visitante de teste e contar slots oferecidos; conferir se um par já agendado some das opções.
- **Falha típica**: matching mostra slot de mesa sem expositor ou fora da janela do evento.
- **Correção**: filtrar no `getAvailableSlots` por `event_tables.exhibitor_profile_id IS NOT NULL` e `time_slots.start_at BETWEEN events.start_at AND events.end_at`.

## Fase 4 — Reserva (booking)

- **Validar**: `bookMeeting` rejeita conflitos — mesma `(table_id, slot_id)`, mesmo `(visitor_profile_id, slot_id)`, par já agendado; dispara e-mail de confirmação PT/ES; grava `audit_logs`.
- **Como testar**: tentar duplicar reserva via UI em duas abas; conferir constraints únicas em `meetings`; checar `email_send_state` para confirmação enviada.
- **Falha típica**: dupla reserva por race condition (sem constraint única no banco).
- **Correção**: garantir `UNIQUE (table_id, slot_id) WHERE status <> 'cancelled'` e `UNIQUE (visitor_profile_id, slot_id) WHERE status <> 'cancelled'`; tratar erro 23505 no `bookMeeting` como conflito amigável.

## Fase 5 — Reagendamento e cancelamento

- **Validar**: `meeting_reschedules` registra origem + destino + motivo + autor; cancelamento marca `status='cancelled'` (não deleta) e libera o slot imediatamente; e-mail PT/ES dispara em ambos os casos.
- **Como testar**: cancelar reunião e tentar nova reserva no mesmo slot — deve aceitar; reagendar e conferir registro em `meeting_reschedules`.
- **Falha típica**: slot continua bloqueado após cancelar (constraint única não considera status).
- **Correção**: usar UNIQUE parcial conforme Fase 4.

## Fase 6 — Dia do evento (execução)

- **Validar**: `general_checkins` na chegada; `meeting_checkins` por reunião; regra de no-show clara (ex.: marcar após 5 min de tolerância) com encaixe imediato; `staff_table_assignments` define quem registra cada mesa; `meeting_outcomes` capturado ao fim de cada reunião.
- **Como testar**: smoke test D-1 percorrendo 1 reunião completa em produção (criar → check-in geral → check-in da reunião → outcome) com staff real e device real.
- **Falha típica**: staff não consegue marcar check-in por falta de atribuição na mesa ou app trava sem Wi-Fi.
- **Correção**: validar `staff_table_assignments` no D-1 e ter fallback offline (lista impressa por mesa/horário, ver `operacao-presencial.md`).

## Fase 7 — Pós-evento e auditoria

- **Validar**: toda `meeting` com horário passado tem desfecho — `meeting_checkin` (compareceu), no-show explícito, ou cancelamento prévio. `audit_logs` cobre criação, cancelamento e reagendamento. KPIs fechados: presença, no-show, encaixe, NPS, leads "quentes".
- **Como testar**: queries de reconciliação abaixo + comparar com lista física dos timekeepers.
- **Falha típica**: reunião "scheduled" em slot passado sem nenhum desfecho → não entra no relatório.
- **Correção**: rotina de fechamento D+1 que força marcar no-show ou compareceu antes de gerar relatório.

## Matriz risco × controle

| Risco | Preventivo | Detectivo | Corretivo |
| --- | --- | --- | --- |
| Overbooking de mesa/slot | UNIQUE parcial em `meetings` | Query "duplicatas ativas" no D-1 | Cancelar a mais recente + reagendar manualmente |
| Slot fantasma (sem mesa válida) | FK `time_slots.table_id → event_tables.id` ON DELETE CASCADE | Query "slots órfãos" | Rodar `rebuild_event_time_slots` |
| Expositor sem mesa | Wizard obriga alocação na aprovação | Query "expositores sem mesa" | Alocar mesa ou desativar perfil |
| E-mail não enviado | `email_send_state` com retry | Query "pendentes > 5 min" | Reprocessar fila, comunicação manual |
| No-show não marcado | Tela do staff força ação após 5 min | Query "scheduled em slot passado" | Marcar no fechamento D+1 |
| Troca de mesa sem rastro | Toda mudança via `meeting_reschedules` | `audit_logs` por meeting_id | Reconstruir histórico do par |
| Par duplicado | Checagem no `bookMeeting` | Query "pares com >1 reunião" | Manter a primeira, cancelar as demais |
| Reunião fora da janela | Validação no `bookMeeting` + filtro no matching | Query "slot fora de events.start_at/end_at" | Reagendar dentro da janela |

## Smoke test ponta a ponta (roteiro reproduzível)

Rodar em **ambiente de produção** com dados de teste claramente marcados (`[TESTE]` em todos os nomes), no mínimo no T-7 e novamente no D-1.

1. Criar evento de teste com 2 mesas, slots de 20 min, buffer de 5 min, janela de 1 hora.
2. Cadastrar 1 expositor de teste + alocar mesa.
3. Cadastrar 2 visitantes de teste com perfis completos.
4. Logar como visitante A → reservar slot 1 na mesa do expositor. Conferir: e-mail PT recebido, audit_log criado, slot some da agenda do visitante B.
5. Logar como visitante B → reservar slot 2. Tentar reservar slot 1 (deve falhar com mensagem amigável).
6. Cancelar a reserva de A. Conferir: e-mail de cancelamento PT, slot volta a aparecer para B.
7. Logar como B → reservar slot 1 (agora livre). Reagendar para slot 2 (conflito esperado se já tem) ou outro slot. Conferir `meeting_reschedules`.
8. Logar como staff atribuído à mesa → marcar `general_checkin` do expositor e de B; marcar `meeting_checkin` da reunião; registrar `meeting_outcome` ("quente"/"morno"/"frio" + notas).
9. Rodar todas as queries de auditoria abaixo — devem retornar zero linhas problemáticas.
10. Limpar dados de teste (cancelar reuniões, desativar perfis `[TESTE]`).

Se qualquer passo falhar: documentar, corrigir e **rodar o roteiro inteiro de novo** — não validar passo isolado.

## Queries SQL de auditoria

Rodar via `supabase--read_query`. Substituir `:event_id` pelo UUID do evento ativo. Toda query deve retornar **zero linhas** em um sistema saudável.

```sql
-- 1. Mesas sem expositor alocado
SELECT id, table_number FROM event_tables
WHERE event_id = :event_id AND exhibitor_profile_id IS NULL;

-- 2. Expositores aprovados sem mesa neste evento
SELECT ep.id, c.name FROM exhibitor_profiles ep
JOIN companies c ON c.id = ep.company_id
LEFT JOIN event_tables et ON et.exhibitor_profile_id = ep.id AND et.event_id = :event_id
WHERE ep.is_active AND et.id IS NULL;

-- 3. Slots sem mesa correspondente (órfãos)
SELECT ts.id, ts.start_at FROM time_slots ts
LEFT JOIN event_tables et ON et.id = ts.table_id
WHERE ts.event_id = :event_id AND et.id IS NULL;

-- 4. Reuniões em slot fora da janela do evento
SELECT m.id, ts.start_at, e.start_at AS event_start, e.end_at AS event_end
FROM meetings m
JOIN time_slots ts ON ts.id = m.slot_id
JOIN events e ON e.id = m.event_id
WHERE m.event_id = :event_id AND m.status <> 'cancelled'
  AND (ts.start_at < e.start_at OR ts.end_at > e.end_at);

-- 5. Duplicatas ativas em mesa+slot
SELECT table_id, slot_id, COUNT(*) FROM meetings
WHERE event_id = :event_id AND status <> 'cancelled'
GROUP BY table_id, slot_id HAVING COUNT(*) > 1;

-- 6. Pares (expositor+visitante) com mais de uma reunião ativa
SELECT m.visitor_profile_id, et.exhibitor_profile_id, COUNT(*) FROM meetings m
JOIN event_tables et ON et.id = m.table_id
WHERE m.event_id = :event_id AND m.status <> 'cancelled'
GROUP BY m.visitor_profile_id, et.exhibitor_profile_id HAVING COUNT(*) > 1;

-- 7. Reuniões scheduled em slot já passado sem check-in nem no-show
SELECT m.id, ts.start_at FROM meetings m
JOIN time_slots ts ON ts.id = m.slot_id
LEFT JOIN meeting_checkins mc ON mc.meeting_id = m.id
WHERE m.event_id = :event_id AND m.status = 'scheduled'
  AND ts.end_at < now() AND mc.id IS NULL;

-- 8. Reagendamentos sem origem ou motivo
SELECT id FROM meeting_reschedules
WHERE event_id = :event_id AND (from_slot_id IS NULL OR reason IS NULL);

-- 9. Visitantes acima do limite (ex.: 8 reuniões)
SELECT visitor_profile_id, COUNT(*) FROM meetings
WHERE event_id = :event_id AND status <> 'cancelled'
GROUP BY visitor_profile_id HAVING COUNT(*) > 8;

-- 10. E-mails de confirmação pendentes há mais de 5 min
SELECT id, kind, created_at FROM email_send_state
WHERE status = 'pending' AND created_at < now() - interval '5 minutes';
```

Adapte os nomes de coluna se o schema divergir — execute primeiro um `\d <tabela>` para confirmar.

## Quando entregar

- **T-30 a T-7**: rodar fases 1–3 (configuração, cadastro, matching) e corrigir antes da abertura da agenda.
- **T-7 a T-1**: rodar fases 4–5 + smoke test completo + queries de auditoria. Sem zero linhas, não abrir a agenda para o público final.
- **D-1**: rodar smoke test inteiro de novo no ambiente real + verificar `staff_table_assignments` e fallback offline.
- **D+1**: rodar fase 7 (reconciliação) antes de fechar relatório.

Sempre entregar o resultado em **tabela** (fase / item / status / dono / prazo) com riscos residuais explícitos no final.