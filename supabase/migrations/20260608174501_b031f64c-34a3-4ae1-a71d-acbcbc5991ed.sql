-- Deduplicate user_roles, keep highest-priority role per user
WITH ranked AS (
  SELECT id, user_id, role,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY CASE role
        WHEN 'admin' THEN 1
        WHEN 'staff' THEN 2
        WHEN 'exhibitor' THEN 3
        WHEN 'visitor' THEN 4
      END
    ) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked r
WHERE ur.id = r.id AND r.rn > 1;

-- Drop old (user_id, role) unique if present and enforce one role per user
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_unique ON public.user_roles(user_id);

-- Update handle_new_user trigger to not conflict on (user_id, role) anymore
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_full_name text; v_lang app_language;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_lang := case when (new.raw_user_meta_data->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;
  insert into public.profiles (auth_user_id, full_name, email, preferred_language)
  values (new.id, v_full_name, new.email, v_lang)
  on conflict (auth_user_id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'visitor')
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

-- Update exhibitor approval trigger to upsert single-role
CREATE OR REPLACE FUNCTION public.handle_exhibitor_request_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_auth_user_id uuid;
begin
  if new.status = 'approved' and (old.status is distinct from 'approved') then
    select auth_user_id into v_auth_user_id from public.profiles where id = new.profile_id;
    if v_auth_user_id is not null then
      insert into public.user_roles (user_id, role) values (v_auth_user_id, 'exhibitor'::app_role)
      on conflict (user_id) do update set role = 'exhibitor'::app_role
      where public.user_roles.role NOT IN ('admin','staff');
    end if;
    insert into public.exhibitor_profiles (profile_id) values (new.profile_id)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$function$;