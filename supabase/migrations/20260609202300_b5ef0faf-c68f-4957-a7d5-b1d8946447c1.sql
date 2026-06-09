-- 1. Companies: explicit INSERT policy restricted to admin/staff
CREATE POLICY "companies insert admin"
ON public.companies
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin_or_staff(auth.uid()));

-- 2. Visitor profiles: drop overly broad exhibitor SELECT exposing consent/internal fields
DROP POLICY IF EXISTS "vis select exhibitor with meeting" ON public.visitor_profiles;