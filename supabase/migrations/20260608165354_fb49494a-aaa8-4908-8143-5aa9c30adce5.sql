
-- 1) staff_table_assignments
CREATE TABLE public.staff_table_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.event_tables(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, table_id, staff_profile_id)
);
CREATE INDEX staff_table_assignments_staff_idx ON public.staff_table_assignments(staff_profile_id);
CREATE INDEX staff_table_assignments_table_idx ON public.staff_table_assignments(table_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_table_assignments TO authenticated;
GRANT ALL ON public.staff_table_assignments TO service_role;

ALTER TABLE public.staff_table_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sta admin all"
  ON public.staff_table_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sta select own staff"
  ON public.staff_table_assignments FOR SELECT
  USING (staff_profile_id = public.current_profile_id());

-- 2) Tighten admin-only writes on key tables
DROP POLICY IF EXISTS "profiles admin all" ON public.profiles;
CREATE POLICY "profiles admin all"
  ON public.profiles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "exh_req admin all" ON public.exhibitor_requests;
CREATE POLICY "exh_req admin all"
  ON public.exhibitor_requests FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "event_tables admin all" ON public.event_tables;
CREATE POLICY "event_tables admin all"
  ON public.event_tables FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "events admin all" ON public.events;
CREATE POLICY "events admin all"
  ON public.events FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "time_slots admin all" ON public.time_slots;
CREATE POLICY "time_slots admin all"
  ON public.time_slots FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
