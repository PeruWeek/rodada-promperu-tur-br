-- Exhibitor approval requests
CREATE TABLE public.exhibitor_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_profile_id uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);

GRANT SELECT, INSERT ON public.exhibitor_requests TO authenticated;
GRANT ALL ON public.exhibitor_requests TO service_role;

ALTER TABLE public.exhibitor_requests ENABLE ROW LEVEL SECURITY;

-- Owner can read their own request
CREATE POLICY "exh_req select own"
ON public.exhibitor_requests FOR SELECT
USING (profile_id = public.current_profile_id());

-- Owner can insert ONLY a pending request for themselves
CREATE POLICY "exh_req insert own pending"
ON public.exhibitor_requests FOR INSERT
WITH CHECK (
  profile_id = public.current_profile_id()
  AND status = 'pending'
);

-- Admin / staff can do anything
CREATE POLICY "exh_req admin all"
ON public.exhibitor_requests FOR ALL
USING (public.is_admin_or_staff(auth.uid()))
WITH CHECK (public.is_admin_or_staff(auth.uid()));

-- Trigger: when status becomes 'approved', grant exhibitor role and ensure exhibitor_profiles row
CREATE OR REPLACE FUNCTION public.handle_exhibitor_request_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT auth_user_id INTO v_auth_user_id FROM public.profiles WHERE id = NEW.profile_id;
    IF v_auth_user_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (v_auth_user_id, 'exhibitor'::app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    INSERT INTO public.exhibitor_profiles (profile_id)
    VALUES (NEW.profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_exhibitor_request_approved
AFTER UPDATE ON public.exhibitor_requests
FOR EACH ROW
EXECUTE FUNCTION public.handle_exhibitor_request_approved();