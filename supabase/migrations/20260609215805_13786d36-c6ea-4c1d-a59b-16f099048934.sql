-- 1) profiles.pending_signup column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_signup boolean NOT NULL DEFAULT false;

-- 2) Unique partial index: only one pending profile per (normalized) email
CREATE UNIQUE INDEX IF NOT EXISTS profiles_pending_email_unique
  ON public.profiles (lower(btrim(email::text)))
  WHERE pending_signup = true AND email IS NOT NULL;

-- 3) Companies dedup by tax_id when present
CREATE UNIQUE INDEX IF NOT EXISTS companies_tax_id_unique
  ON public.companies (tax_id)
  WHERE tax_id IS NOT NULL AND btrim(tax_id) <> '';

-- 4) handle_new_user: claim pending profile by email if one exists
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
  v_lang app_language;
  v_pending_id uuid;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_lang := case when (new.raw_user_meta_data->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;

  -- Try to claim a pending pre-registered profile with the same email.
  SELECT id INTO v_pending_id
  FROM public.profiles
  WHERE pending_signup = true
    AND auth_user_id IS NULL
    AND email IS NOT NULL
    AND lower(btrim(email::text)) = lower(btrim(new.email))
  FOR UPDATE
  LIMIT 1;

  IF v_pending_id IS NOT NULL THEN
    UPDATE public.profiles
    SET auth_user_id = new.id,
        pending_signup = false,
        -- only fill empty fields; never overwrite pre-registered data here
        full_name = COALESCE(NULLIF(btrim(full_name), ''), v_full_name),
        preferred_language = COALESCE(preferred_language, v_lang)
    WHERE id = v_pending_id;
  ELSE
    INSERT INTO public.profiles (auth_user_id, full_name, email, preferred_language)
    VALUES (new.id, v_full_name, new.email, v_lang)
    ON CONFLICT (auth_user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'visitor')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
end;
$function$;