## Ajustes finais aprovados

### 1) Cleanup — vencedora por empresa mais antiga; preservar mesma empresa

Regra correta implementada:

1. Para cada par `(table_id, slot_id)` do evento, encontrar a **empresa vencedora** = `company_id` da reunião mais antiga (`MIN(created_at)`) entre as reuniões `scheduled` daquele par com `company_id NOT NULL`.
2. **Cancelar apenas** reuniões cuja `company_id != vencedora` (ou `company_id IS NULL`, defensivamente).
3. Preservar TODAS as reuniões da empresa vencedora, mesmo que múltiplas pessoas — "mesma empresa no mesmo slot" continua válido pela regra oficial.

SQL final do cleanup (dentro da mesma migration, escopado por `event_id`, `status='scheduled'`, com `audit_logs` e idempotente):

```sql
WITH scoped AS (
  SELECT m.id, m.table_id, m.slot_id, m.created_at, p.company_id
    FROM public.meetings m
    JOIN public.profiles p ON p.id = m.visitor_profile_id
   WHERE m.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
     AND m.status   = 'scheduled'
),
winners AS (
  -- Empresa vencedora por par = a empresa da reunião mais antiga (com company_id NOT NULL).
  SELECT DISTINCT ON (table_id, slot_id)
         table_id, slot_id, company_id AS winner_company_id
    FROM scoped
   WHERE company_id IS NOT NULL
   ORDER BY table_id, slot_id, created_at ASC
),
losers AS (
  -- Cancelar apenas quem está em par com > 1 empresa distinta E não é da vencedora.
  SELECT s.id, s.table_id, s.slot_id
    FROM scoped s
    JOIN winners w
      ON w.table_id = s.table_id
     AND w.slot_id  = s.slot_id
   WHERE (s.company_id IS DISTINCT FROM w.winner_company_id)
     AND EXISTS (
       SELECT 1 FROM scoped s2
        WHERE s2.table_id = s.table_id
          AND s2.slot_id  = s.slot_id
          AND s2.company_id IS DISTINCT FROM w.winner_company_id
     )
),
cancelled AS (
  UPDATE public.meetings m
     SET status        = 'cancelled',
         cancel_reason = 'data cleanup: slot já ocupado por outra empresa (incidente 2026-07-03)'
    FROM losers l
   WHERE m.id       = l.id
     AND m.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'   -- escopo duro
     AND m.status   = 'scheduled'                               -- só scheduled
  RETURNING m.id, m.event_id, m.table_id, m.slot_id, m.visitor_profile_id
)
INSERT INTO public.audit_logs (action, actor_profile_id, event_id, payload)
SELECT
  'meeting.cleanup_cancelled',
  NULL,
  c.event_id,
  jsonb_build_object(
    'meeting_id',         c.id,
    'table_id',           c.table_id,
    'slot_id',            c.slot_id,
    'visitor_profile_id', c.visitor_profile_id,
    'incident',           '1-slot-1-empresa 2026-07-03',
    'source',             'migration hardening_1_slot_1_empresa'
  )
FROM cancelled c;
```

Salvaguardas mantidas:

- Escopo duro por `event_id` e `status='scheduled'`.
- **Idempotente:** ao rerodar, `losers` fica vazio → `UPDATE` afeta 0 → `audit_logs` insere 0.
- **Preserva mesma-empresa multi-visitante:** o par mesa 11 · 12:30 (Carla + Juliana, ambas Ambiental) NÃO é tocado porque `winners` = Ambiental e nenhuma das duas reuniões cai em `losers`.
- **Sem lista hardcoded:** deriva do estado atual; qualquer novo par conflitante criado antes da execução é pego.

Aplicado sobre o estado atual, esse SQL resolve exatamente os **9 pares e cancela os 9 IDs** listados no plano anterior — todos de Yasmin (segunda a chegar em pares onde a empresa vencedora é outra). O par 11 · 12:30 é preservado.

### 2) View `v_company_event_pipeline` — mudança só no ramo exhibitor

Definição final por ramo:

- **`company_role = 'exhibitor'`**: passa a usar `COUNT(DISTINCT (m.table_id, m.slot_id))`. Semântica = "pares físicos ocupados nas mesas da empresa". Consertar aqui é o que faz o card `Com agendamento · N` do expositor bater com a aba de disponibilidade e nunca ultrapassar o total de slots físicos da mesa. **Este é o card do incidente.**
- **`company_role = 'visitor'`**: **permanece `COUNT(*)` de meetings scheduled** dos visitantes da empresa. Não é alvo do incidente e a semântica é diferente: o pipeline de visitante mede "quantas reuniões meus visitantes fecharam" contra a meta de 6 por perfil. Só será alterado depois de validação separada com o cliente.

Definição SQL final:

```sql
( SELECT
    CASE cep.company_role
      WHEN 'exhibitor' THEN (
        SELECT COUNT(*) FROM (
          SELECT DISTINCT m.table_id, m.slot_id
            FROM public.meetings m
           WHERE m.event_id = cep.event_id
             AND m.status   = 'scheduled'
             AND m.table_id IN (
               SELECT et.id
                 FROM public.event_tables et
                 JOIN public.profiles p2 ON p2.id = et.exhibitor_profile_id
                WHERE p2.company_id = cep.company_id
             )
        ) d
      )
      WHEN 'visitor' THEN (
        SELECT COUNT(*)
          FROM public.meetings m
         WHERE m.event_id = cep.event_id
           AND m.status   = 'scheduled'
           AND m.visitor_profile_id IN (
             SELECT id FROM public.profiles WHERE company_id = cep.company_id
           )
      )
      ELSE 0
    END
) AS scheduled_meetings_count
```

Resto da view idêntico ao atual.

### 3) Queries de prova, escopadas ao evento do incidente

```sql
-- (a) zero conflitos no evento do incidente
WITH pairs AS (
  SELECT m.table_id, m.slot_id
    FROM public.meetings m
    JOIN public.profiles p ON p.id = m.visitor_profile_id
   WHERE m.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
     AND m.status   = 'scheduled'
   GROUP BY m.table_id, m.slot_id
  HAVING COUNT(DISTINCT p.company_id)
           FILTER (WHERE p.company_id IS NOT NULL) > 1
) SELECT COUNT(*) AS conflicting_pairs FROM pairs;
-- esperado: 0

-- (b) nenhuma mesa do evento com > 20 pares ocupados
SELECT et.table_number, COUNT(DISTINCT (m.table_id, m.slot_id)) AS booked_pairs
  FROM public.event_tables et
  JOIN public.meetings m
    ON m.table_id = et.id AND m.status = 'scheduled'
 WHERE et.event_id = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
   AND m.event_id  = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
 GROUP BY et.id, et.table_number
HAVING COUNT(DISTINCT (m.table_id, m.slot_id)) > 20;
-- esperado: 0 linhas

-- (c) nenhum card expositor do evento com "Com agendamento" > 20
SELECT company_trade_name, scheduled_meetings_count
  FROM public.v_company_event_pipeline
 WHERE event_id      = 'd86be1b5-857e-44c4-9d69-1f4f4d8b1bdb'
   AND company_role  = 'exhibitor'
   AND scheduled_meetings_count > 20;
-- esperado: 0 linhas
```

---

## Restante do plano (inalterado)

- **Trigger `enforce_meeting_no_conflict`**: única mudança = adicionar `SECURITY DEFINER`. Corpo idêntico; `pg_advisory_xact_lock` já embutido cobre concorrência. Nenhum constraint trigger auxiliar.
- **Testes de invariante** (novos):
  - `src/lib/__tests__/scheduling-view-invariant.test.ts` — regex sobre migrations garante que o ramo `exhibitor` de `v_company_event_pipeline` usa `DISTINCT (m.table_id, m.slot_id)`.
  - `src/lib/__tests__/scheduling-trigger-invariant.test.ts` — garante `SECURITY DEFINER` em `enforce_meeting_no_conflict`.
- **Doc**: item novo em `docs/scheduling-regression-checklist.md` — "expositor com N slots físicos nunca mostra `Com agendamento > N`".
- **Nenhuma alteração em código TypeScript de motor, UI, RLS ou fluxos de reacomodação.**

## Arquivos alterados

- `supabase/migrations/<timestamp>_hardening_1_slot_1_empresa.sql` (novo — contém: SECURITY DEFINER + view + cleanup + audit)
- `src/lib/__tests__/scheduling-view-invariant.test.ts` (novo)
- `src/lib/__tests__/scheduling-trigger-invariant.test.ts` (novo)
- `docs/scheduling-regression-checklist.md` (item novo)
