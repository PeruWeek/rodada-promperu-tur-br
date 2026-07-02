## Auditoria global (executada agora)

```sql
SELECT p.company_id, m.event_id, ts.start_at,
       array_agg(m.id ORDER BY m.created_at) meeting_ids, count(*) n
FROM meetings m
JOIN profiles p    ON p.id  = m.visitor_profile_id
JOIN time_slots ts ON ts.id = m.slot_id
WHERE m.status = 'scheduled' AND p.company_id IS NOT NULL
GROUP BY p.company_id, m.event_id, ts.start_at
HAVING count(*) > 1;
```

**Conflitos encontrados: 1** — BWT OPERADORA, evento `d86be1b5…`, slot 09:15 BRT (`12:15:00+00`), meetings `ea4144a9…` (mesa 10, manter) e `2021bbf2…` (mesa 11, cancelar). Nenhum outro caso legado.

**Reconciliação**: `UPDATE meetings SET status='cancelled', cancel_reason='admin_dedupe_company_slot' WHERE id='2021bbf2-4494-4334-a04d-22f6e0b6de4b'` via `supabase--insert` + `audit_logs` + `notifications` (`meeting_cancelled`) ao expositor da mesa 11.

## Semântica do horário

Verificado: todos os `time_slots` do evento têm duração uniforme de 15min e o self-join `a.start_at < b.end_at AND b.start_at < a.end_at` (excluindo pares idênticos) retorna 0. Comparação por `(start_at, end_at)` é semanticamente equivalente a overlap. Não vira range.

## Guardas backend

`src/lib/booking.functions.ts` e `src/lib/exhibitor-availability.functions.ts`: antes do INSERT, verificar existência de meeting `scheduled` no mesmo `event_id` + `(start_at, end_at)` cujo `visitor.company_id` seja igual ao da empresa alvo. Mensagem canônica: `Esta empresa já possui uma reunião agendada neste horário.` Guarda por `visitor_profile_id` continua.

## Trigger final (com short-circuit)

```sql
CREATE OR REPLACE FUNCTION public.enforce_one_company_per_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_clash   uuid;
BEGIN
  -- Short-circuit: UPDATE que não mexe em nenhum campo relevante à regra.
  IF TG_OP = 'UPDATE'
     AND NEW.status             = OLD.status
     AND NEW.event_id           = OLD.event_id
     AND NEW.slot_id            = OLD.slot_id
     AND NEW.visitor_profile_id = OLD.visitor_profile_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO v_company FROM public.profiles WHERE id = NEW.visitor_profile_id;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT start_at, end_at INTO v_start, v_end
  FROM public.time_slots WHERE id = NEW.slot_id;

  SELECT m.id INTO v_clash
  FROM public.meetings m
  JOIN public.profiles   p  ON p.id  = m.visitor_profile_id
  JOIN public.time_slots ts ON ts.id = m.slot_id
  WHERE m.event_id   = NEW.event_id
    AND m.status     = 'scheduled'
    AND m.id        <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND p.company_id = v_company
    AND ts.start_at  = v_start
    AND ts.end_at    = v_end
  LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Esta empresa já possui uma reunião agendada neste horário.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_meetings_one_company_per_slot ON public.meetings;
CREATE TRIGGER trg_meetings_one_company_per_slot
BEFORE INSERT OR UPDATE ON public.meetings          -- sem OF <cols>: sem bypass
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_company_per_slot();
```

Notas:
- Short-circuit compara **valores** (não colunas listadas no `OF`), então continua sem bypass: qualquer mudança em `status`/`event_id`/`slot_id`/`visitor_profile_id` — inclusive via UPDATE genérico — reentra na validação. Mudanças em colunas irrelevantes (`cancel_reason`, `updated_at`, notas) saem baratas.
- `NULL`s dessas colunas: em `meetings` as quatro são `NOT NULL`, então a comparação `=` é segura; se algum dia deixarem de ser, trocar por `IS NOT DISTINCT FROM`.

## Frontend do agendamento manual

`src/components/admin/book-for-registrant-dialog.tsx` e `src/components/booking-dialog.tsx`: filtrar `free_slots` removendo `(start_at, end_at)` já ocupados por outros perfis da mesma `company_id` do alvo/usuário. Race no submit: toast com a mensagem canônica antes de chamar o backend.

## Entrega ao usuário

1. Causa raiz: validação de duplicidade só existia por `visitor_profile_id`, permitindo agendar a mesma empresa em mesas diferentes no mesmo horário via fluxo manual admin.
2. Cancelamento da mesa 11 confirmado por `SELECT` pós-reconciliação.
3. Arquivos alterados: `src/lib/booking.functions.ts`, `src/lib/exhibitor-availability.functions.ts`, `src/components/admin/book-for-registrant-dialog.tsx`, `src/components/booking-dialog.tsx` + 1 migração.
4. Migração: função `enforce_one_company_per_slot` + trigger `trg_meetings_one_company_per_slot` (BEFORE INSERT OR UPDATE, sem lista de colunas, com short-circuit por valores).
5. Prova: auditoria global reexecutada (retorno vazio) + tentativa de INSERT duplicado bloqueada pela trigger com a mensagem canônica.
