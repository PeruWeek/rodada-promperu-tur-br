
-- 1) Tighten profiles SELECT: hide email from non-self/non-admin readers via column grants
DROP POLICY IF EXISTS "profiles select all authenticated" ON public.profiles;

CREATE POLICY "profiles select authenticated limited"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, auth_user_id, company_id, full_name, preferred_language, is_active, created_at)
  ON public.profiles TO authenticated;

-- 2) Visitor profiles: allow exhibitors to read profiles of visitors who have a meeting at their table
CREATE POLICY "vis select exhibitor with meeting"
ON public.visitor_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.meetings m
    JOIN public.event_tables et ON et.id = m.table_id
    WHERE m.visitor_profile_id = visitor_profiles.profile_id
      AND et.exhibitor_profile_id = public.current_profile_id()
  )
);

-- 3) Companies: remove permissive INSERT for any authenticated user
DROP POLICY IF EXISTS "companies insert auth" ON public.companies;
-- Admin policy ("companies update admin"/"companies delete admin") still allows admin work.
-- Add scoped insert: authenticated users may create a company only if their profile has no company yet.
CREATE POLICY "companies insert onboarding"
ON public.companies
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.company_id IS NULL
  )
);

-- 4) Restrict EXECUTE on SECURITY DEFINER helpers — only service_role / triggers / RLS need them
REVOKE EXECUTE ON FUNCTION public.is_admin_or_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_profile_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rebuild_event_time_slots(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- match_rag_chunks is callable via PostgREST RPC but the function itself enforces admin/staff;
-- keep it executable by authenticated so the internal admin/staff check applies.
GRANT EXECUTE ON FUNCTION public.match_rag_chunks(uuid, public.vector, integer) TO authenticated;
