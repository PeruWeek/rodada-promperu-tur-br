-- Backfill defensivo: realinha `scheduling_status` no banco a partir do
-- count real (`pipeline_recalc_scheduling`). Não altera enum, triggers ou
-- estruturas. Apenas reduz inconsistência entre texto e count para linhas
-- legadas. A regra global (count = fonte da verdade) já é aplicada pela
-- aplicação independentemente disto.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT event_id, company_id
    FROM public.company_event_pipeline
  LOOP
    BEGIN
      PERFORM public.pipeline_recalc_scheduling(r.event_id, r.company_id);
    EXCEPTION WHEN OTHERS THEN
      -- Não interromper o backfill por causa de uma linha problemática.
      RAISE NOTICE 'Skipping pipeline_recalc_scheduling for (%, %): %', r.event_id, r.company_id, SQLERRM;
    END;
  END LOOP;
END $$;