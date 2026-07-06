DROP FUNCTION IF EXISTS public.public_exhibitor_catalog(uuid);
DROP FUNCTION IF EXISTS public.public_exhibitor_detail(uuid);

CREATE FUNCTION public.public_exhibitor_catalog(_event_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(
   profile_id uuid,
   full_name text,
   trade_name text,
   country_code text,
   city text,
   segments text[],
   services text[],
   destinations text[],
   table_number integer,
   available_slots_count integer
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING HINT = 'Sign in to view exhibitors.';
  END IF;

  v_event := COALESCE(_event_id, public.pipeline_active_event_id());

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'no_active_event' USING HINT = 'Configure an active event in admin.';
  END IF;

  RETURN QUERY
  SELECT
    p.id          AS profile_id,
    p.full_name,
    c.trade_name,
    c.country_code,
    c.city,
    COALESCE(ep.segments,    '{}'::text[]) AS segments,
    COALESCE(ep.services,    '{}'::text[]) AS services,
    COALESCE(ep.destinations,'{}'::text[]) AS destinations,
    et.table_number,
    (SELECT COUNT(*)::int
       FROM public.time_slots ts
      WHERE ts.table_id = et.id
        AND ts.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.meetings m
           WHERE m.table_id = et.id
             AND m.slot_id  = ts.id
             AND m.status   = 'scheduled'
        )) AS available_slots_count
  FROM public.exhibitor_profiles ep
  JOIN public.profiles    p  ON p.id = ep.profile_id
  JOIN public.companies   c  ON c.id = p.company_id
  JOIN public.user_roles  ur ON ur.user_id = p.auth_user_id AND ur.role = 'exhibitor'::app_role
  JOIN public.event_tables et
    ON et.exhibitor_profile_id = p.id
   AND et.event_id = v_event
  WHERE p.is_active = true
    AND p.company_id IS NOT NULL
    AND c.is_active = true;
END;
$function$;

CREATE FUNCTION public.public_exhibitor_detail(_profile_id uuid, _event_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(
   profile_id uuid,
   full_name text,
   company_id uuid,
   trade_name text,
   country_code text,
   city text,
   website text,
   linkedin text,
   instagram text,
   table_number integer,
   pitch_pt text,
   pitch_es text,
   portfolio_pt text,
   portfolio_es text,
   segments text[],
   services text[],
   destinations text[],
   target_buyers text[],
   materials_links text[],
   available_slots_count integer
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid;
BEGIN
  v_event := COALESCE(_event_id, public.pipeline_active_event_id());

  RETURN QUERY
  SELECT
    p.id::uuid AS profile_id,
    p.full_name,
    p.company_id,
    c.trade_name,
    c.country_code,
    c.city,
    c.website,
    c.linkedin,
    c.instagram,
    et.table_number,
    ep.pitch_pt,
    ep.pitch_es,
    ep.portfolio_pt,
    ep.portfolio_es,
    ep.segments,
    ep.services,
    ep.destinations,
    ep.target_buyers,
    ep.materials_links,
    COALESCE((
      SELECT COUNT(*)::int
        FROM public.time_slots ts
       WHERE ts.table_id = et.id
         AND ts.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM public.meetings m
            WHERE m.table_id = et.id
              AND m.slot_id  = ts.id
              AND m.status   = 'scheduled'
         )
    ), 0) AS available_slots_count
  FROM public.profiles p
  JOIN public.exhibitor_profiles ep ON ep.profile_id = p.id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.event_tables et
    ON et.exhibitor_profile_id = p.id
   AND et.event_id = v_event
  WHERE p.id = _profile_id
    AND p.is_active = true
    AND p.company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.auth_user_id AND ur.role = 'exhibitor'
    )
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_exhibitor_catalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_exhibitor_catalog(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.public_exhibitor_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_exhibitor_detail(uuid, uuid) TO authenticated, service_role;