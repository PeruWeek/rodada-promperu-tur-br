CREATE OR REPLACE FUNCTION public.public_exhibitor_detail(_profile_id uuid)
RETURNS TABLE (
  profile_id uuid,
  full_name text,
  company_id uuid,
  trade_name text,
  country_code text,
  city text,
  website text,
  linkedin text,
  instagram text,
  table_number int,
  pitch_pt text,
  pitch_es text,
  portfolio_pt text,
  portfolio_es text,
  segments text[],
  services text[],
  destinations text[],
  target_buyers text[],
  materials_links text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    ep.materials_links
  FROM public.profiles p
  JOIN public.exhibitor_profiles ep ON ep.profile_id = p.id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.event_tables et ON et.exhibitor_profile_id = p.id
  WHERE p.id = _profile_id
    AND p.is_active = true
    AND p.company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.auth_user_id AND ur.role = 'exhibitor'
    )
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.public_exhibitor_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_exhibitor_detail(uuid) TO authenticated, service_role;