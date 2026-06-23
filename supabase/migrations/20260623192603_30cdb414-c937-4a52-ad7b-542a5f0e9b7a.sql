CREATE OR REPLACE FUNCTION public.transition_primary_role(p_auth_user_id uuid, p_target_role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- `cliente` is a real business role and must be selectable as a primary
  -- participant role. Never silently rewrite it to `exhibitor`.
  IF p_target_role::text NOT IN ('visitor', 'exhibitor', 'cliente') THEN
    RAISE EXCEPTION 'transition_primary_role: target must be visitor, cliente or exhibitor, got %', p_target_role;
  END IF;

  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE auth_user_id = p_auth_user_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'transition_primary_role: profile not found for auth_user_id %', p_auth_user_id;
  END IF;

  SELECT jsonb_build_object(
    'roles', COALESCE((SELECT jsonb_agg(role::text ORDER BY role::text) FROM public.user_roles WHERE user_id = p_auth_user_id), '[]'::jsonb),
    'has_visitor_profile', EXISTS(SELECT 1 FROM public.visitor_profiles WHERE profile_id = v_profile_id),
    'has_exhibitor_profile', EXISTS(SELECT 1 FROM public.exhibitor_profiles WHERE profile_id = v_profile_id)
  ) INTO v_before;

  -- Remove conflicting primary roles (visitor / exhibitor / cliente are mutually
  -- exclusive as primary roles). Admin / staff are additive and preserved.
  DELETE FROM public.user_roles
  WHERE user_id = p_auth_user_id
    AND role::text IN ('visitor', 'exhibitor', 'cliente');

  INSERT INTO public.user_roles(user_id, role)
  VALUES (p_auth_user_id, p_target_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Materialize the matching profile row only when relevant. `cliente` does
  -- not own a visitor_profiles or exhibitor_profiles record.
  IF p_target_role::text = 'exhibitor' THEN
    INSERT INTO public.exhibitor_profiles(profile_id)
    VALUES (v_profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
  ELSIF p_target_role::text = 'visitor' THEN
    INSERT INTO public.visitor_profiles(profile_id)
    VALUES (v_profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  SELECT jsonb_build_object(
    'roles', COALESCE((SELECT jsonb_agg(role::text ORDER BY role::text) FROM public.user_roles WHERE user_id = p_auth_user_id), '[]'::jsonb),
    'has_visitor_profile', EXISTS(SELECT 1 FROM public.visitor_profiles WHERE profile_id = v_profile_id),
    'has_exhibitor_profile', EXISTS(SELECT 1 FROM public.exhibitor_profiles WHERE profile_id = v_profile_id)
  ) INTO v_after;

  BEGIN
    INSERT INTO public.audit_logs(actor_profile_id, action, payload)
    VALUES (
      NULL,
      'transition_primary_role',
      jsonb_build_object(
        'auth_user_id', p_auth_user_id,
        'profile_id', v_profile_id,
        'target_role', p_target_role::text,
        'before', v_before,
        'after', v_after
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('profile_id', v_profile_id, 'new_role', p_target_role::text);
END;
$function$;