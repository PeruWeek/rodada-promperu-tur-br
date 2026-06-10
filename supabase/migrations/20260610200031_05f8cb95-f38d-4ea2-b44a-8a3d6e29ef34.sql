CREATE OR REPLACE FUNCTION public.admin_list_orphan_exhibitors()
RETURNS TABLE(
  profile_id uuid,
  email text,
  full_name text,
  is_active boolean,
  has_exhibitor_request boolean,
  request_status text,
  table_number integer,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid AS profile_id,
    p.email::text AS email,
    p.full_name::text AS full_name,
    p.is_active::boolean AS is_active,
    (er.id IS NOT NULL)::boolean AS has_exhibitor_request,
    er.status::text AS request_status,
    et.table_number::integer AS table_number,
    p.created_at::timestamp with time zone AS created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN LATERAL (
    SELECT req.id, req.status
    FROM public.exhibitor_requests req
    WHERE req.profile_id = p.id
    ORDER BY req.created_at DESC
    LIMIT 1
  ) er ON true
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = public.pipeline_active_event_id()
  WHERE p.company_id IS NULL
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_unpublished_exhibitors()
RETURNS TABLE(
  profile_id uuid,
  email text,
  full_name text,
  trade_name text,
  reason text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid := public.pipeline_active_event_id();
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id::uuid AS profile_id,
    p.email::text AS email,
    p.full_name::text AS full_name,
    c.trade_name::text AS trade_name,
    (
      CASE
        WHEN v_event IS NULL THEN 'no_active_event'
        WHEN c.id IS NULL THEN 'no_company'
        WHEN p.is_active IS NOT TRUE THEN 'inactive'
        WHEN ur.user_id IS NULL THEN 'missing_role'
        WHEN et.id IS NULL THEN 'no_table'
        ELSE 'unknown'
      END
    )::text AS reason,
    p.created_at::timestamp with time zone AS created_at
  FROM public.exhibitor_profiles ep
  JOIN public.profiles p ON p.id = ep.profile_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.user_roles ur
         ON ur.user_id = p.auth_user_id
        AND ur.role = 'exhibitor'::app_role
  LEFT JOIN public.event_tables et
         ON et.exhibitor_profile_id = p.id
        AND et.event_id = v_event
  WHERE p.company_id IS NOT NULL
    AND (
      v_event IS NULL
      OR c.id IS NULL
      OR p.is_active IS NOT TRUE
      OR ur.user_id IS NULL
      OR et.id IS NULL
    )
  ORDER BY p.created_at DESC;
END;
$$;