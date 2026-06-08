
ALTER VIEW public.v_company_event_pipeline SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.derive_region_label(text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pipeline_active_event_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pipeline_compute_complete(uuid,uuid,public.pipeline_company_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pipeline_recalc_scheduling(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pipeline_ensure_row(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cep_guard_owner_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_pipeline_after_company() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_pipeline_after_profile_company() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_pipeline_after_meeting() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_pipeline_after_exh_request() FROM PUBLIC, anon;
