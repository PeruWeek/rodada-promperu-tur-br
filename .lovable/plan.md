# Plano: ampliar skill `rodada-b2b-eventos` com validação do processo de agendamento

A skill atual cobre operação presencial, dinâmica de grupos e modelos de entregáveis. Falta um eixo: **auditar/validar o processo de agendamento de ponta a ponta** (do convite até a reunião acontecer e ser registrada). Vou adicionar uma nova reference e ligar o SKILL.md a ela.

## Arquivos a alterar/criar

```
.agents/skills/rodada-b2b-eventos/
├── SKILL.md                                 (editar — adicionar gatilho + ponteiro + entregável "validação")
└── references/
    └── validacao-agendamento.md             (NOVO)
```

## Conteúdo de `references/validacao-agendamento.md`

Checklist de validação dividido nas 7 fases do agendamento, cada uma com: o que validar, como testar, sinais de falha, correção. Específico para a stack deste projeto (tabelas `events`, `event_tables`, `time_slots`, `meetings`, `meeting_reschedules`, `meeting_checkins`, `meeting_outcomes`, `staff_table_assignments`, `general_checkins`, `exhibitor_requests`).

### Fase 1 — Configuração do evento
- Evento ativo único; janelas de início/fim coerentes; fuso correto.
- Duração de slot + buffer + pausas definidos antes de gerar `time_slots`.
- Validar: `events` (datas, capacidade), `event_tables` (numeração contínua, sem duplicatas), `rebuild_event_time_slots` rodado após qualquer mudança de horário.

### Fase 2 — Cadastro e elegibilidade
- Expositor: `companies` + `exhibitor_profiles` completos + mesa atribuída em `event_tables.exhibitor_profile_id`.
- Visitante: `companies` + `visitor_profiles` (interesses/segmentos preenchidos).
- Aprovação de `exhibitor_requests` antes de virar expositor.
- Validar: queries de "expositores sem mesa", "mesas sem expositor", "visitantes sem perfil completo".

### Fase 3 — Matching e abertura de agenda
- Critérios de priorização explícitos (interesse > setor > porte > região).
- Limites: máx. reuniões/pessoa, sem par duplicado, sem concorrentes sem opt-in.
- Visibilidade de `time_slots` no `/explore` respeita janela e mesas com expositor.
- Validar: simular 1 visitante e contar slots oferecidos.

### Fase 4 — Reserva (booking)
- `bookMeeting` rejeita conflitos: mesma mesa+slot ocupado, mesmo visitante+slot, par duplicado.
- E-mail de confirmação dispara em PT/ES.
- Audit log gravado.
- Validar: tentar duplicar reserva via UI; checar `meetings` (constraint única `(table_id, slot_id)` e `(visitor_profile_id, slot_id)`).

### Fase 5 — Reagendamento e cancelamento
- `meeting_reschedules` registra origem/destino + motivo.
- Cancelamento libera o slot imediatamente (status=`cancelled`, não delete).
- E-mail de cancelamento/reagendamento PT/ES.
- Validar: cancelar reunião e tentar nova reserva no mesmo slot.

### Fase 6 — Dia do evento (execução)
- `general_checkins` por chegada; `meeting_checkins` por reunião.
- Regra de no-show: marcar após 5 min; permitir encaixe imediato.
- `staff_table_assignments` define quem registra cada mesa.
- `meeting_outcomes` capturado ao fim de cada reunião.
- Validar: percorrer 1 reunião completa em ambiente real (smoke test D-1).

### Fase 7 — Pós-evento e auditoria
- Reconciliação: toda `meeting` com `status` final tem `meeting_checkin` ou justificativa.
- `audit_logs` cobre criação/cancelamento/reagendamento.
- KPIs fechados: presença, no-show, encaixe, NPS, "quente".

### Matriz de risco × controle
Tabela com riscos típicos (overbooking, slot fantasma, expositor sem mesa, e-mail não enviado, no-show não marcado, troca de mesa sem rastro) → controle preventivo + detectivo + corretivo.

### Smoke test ponta a ponta (roteiro reproduzível)
Passo a passo numerado: criar evento de teste → gerar mesas → gerar slots → cadastrar 1 expositor + 2 visitantes → 1 reserva → 1 cancelamento → 1 reagendamento → 1 check-in geral → 1 check-in de reunião → 1 outcome → checar audit_logs e e-mails.

### Queries SQL de auditoria
Bloco com 8–10 SELECTs prontos para rodar via `supabase--read_query`:
- mesas sem expositor / expositores sem mesa
- slots sem `event_tables` correspondente
- reuniões com slot fora da janela do evento
- pares duplicados
- reuniões `scheduled` em slot passado sem check-in nem no-show
- reschedules sem origem registrada
- visitantes acima do limite de reuniões
- e-mails de confirmação pendentes no `email_send_state`

## Ajustes em SKILL.md

- Adicionar à descrição (gatilhos): "validar/auditar processo de agendamento ponta a ponta".
- Adicionar entregável **8. Validação do processo de agendamento** (auditoria por fase + smoke test + queries SQL).
- Adicionar ponteiro `references/validacao-agendamento.md` na seção "Quando ir fundo".
- Adicionar 1 regra de ouro: "Antes do D-1, rode o smoke test ponta a ponta em ambiente real".

## Próximo passo após aprovação

No modo build: editar SKILL.md, criar `references/validacao-agendamento.md`, aplicar com `skills--apply_draft .agents/skills/rodada-b2b-eventos`.
