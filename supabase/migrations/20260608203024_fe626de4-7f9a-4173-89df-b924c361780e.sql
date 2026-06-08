CREATE OR REPLACE FUNCTION public.ensure_exhibitor_profile_on_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare v_profile_id uuid;
begin
  if NEW.role = 'exhibitor'::app_role then
    select id into v_profile_id from public.profiles where auth_user_id = NEW.user_id;
    if v_profile_id is not null then
      insert into public.exhibitor_profiles (profile_id) values (v_profile_id)
      on conflict (profile_id) do nothing;
    end if;
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_ensure_exhibitor_profile ON public.user_roles;
CREATE TRIGGER trg_ensure_exhibitor_profile
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_exhibitor_profile_on_role();