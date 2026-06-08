
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS general_phone text,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS import_profile text;

ALTER TABLE public.visitor_profiles
  ADD COLUMN IF NOT EXISTS additional_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.complete_buyer_signup(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile_id uuid; v_company_id uuid; v_existing_company uuid; v_lang app_language;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_payload->>'trade_name'), '') = '' then raise exception 'trade_name required'; end if;
  if coalesce(btrim(p_payload->>'city'), '') = '' then raise exception 'city required'; end if;
  if coalesce(btrim(p_payload->>'state_code'), '') = '' then raise exception 'state_code required'; end if;
  if coalesce(btrim(p_payload->>'full_name'), '') = '' then raise exception 'full_name required'; end if;
  if (p_payload->>'consent_data_sharing')::boolean is not true then raise exception 'consent_data_sharing required'; end if;
  v_lang := case when (p_payload->>'preferred_language') = 'es' then 'es'::app_language else 'pt-BR'::app_language end;
  select id, company_id into v_profile_id, v_existing_company
  from public.profiles where auth_user_id = auth.uid() for update;
  if v_profile_id is null then raise exception 'Profile not found'; end if;
  if v_existing_company is null then
    insert into public.companies (
      trade_name, legal_name, tax_id, country_code, state_code, city, website, instagram, linkedin,
      address, general_phone, specialty, import_profile
    )
    values (
      btrim(p_payload->>'trade_name'),
      nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      'BR', upper(btrim(p_payload->>'state_code')), btrim(p_payload->>'city'),
      nullif(btrim(coalesce(p_payload->>'website','')), ''),
      nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      nullif(btrim(coalesce(p_payload->>'linkedin','')), ''),
      nullif(btrim(coalesce(p_payload->>'address','')), ''),
      nullif(btrim(coalesce(p_payload->>'general_phone','')), ''),
      nullif(btrim(coalesce(p_payload->>'specialty','')), ''),
      nullif(btrim(coalesce(p_payload->>'import_profile','')), '')
    ) returning id into v_company_id;
  else
    v_company_id := v_existing_company;
    update public.companies set
      trade_name = btrim(p_payload->>'trade_name'),
      legal_name = nullif(btrim(coalesce(p_payload->>'legal_name','')), ''),
      tax_id = nullif(btrim(coalesce(p_payload->>'tax_id','')), ''),
      country_code = 'BR', state_code = upper(btrim(p_payload->>'state_code')),
      city = btrim(p_payload->>'city'),
      website = nullif(btrim(coalesce(p_payload->>'website','')), ''),
      instagram = nullif(btrim(coalesce(p_payload->>'instagram','')), ''),
      linkedin = nullif(btrim(coalesce(p_payload->>'linkedin','')), ''),
      address = nullif(btrim(coalesce(p_payload->>'address','')), ''),
      general_phone = nullif(btrim(coalesce(p_payload->>'general_phone','')), ''),
      specialty = nullif(btrim(coalesce(p_payload->>'specialty','')), ''),
      import_profile = nullif(btrim(coalesce(p_payload->>'import_profile','')), '')
    where id = v_company_id;
  end if;
  update public.profiles set
    full_name = btrim(p_payload->>'full_name'),
    job_title = nullif(btrim(coalesce(p_payload->>'job_title','')), ''),
    phone = nullif(btrim(coalesce(p_payload->>'phone','')), ''),
    whatsapp = nullif(btrim(coalesce(p_payload->>'whatsapp','')), ''),
    preferred_language = v_lang, company_id = v_company_id
  where id = v_profile_id;
  insert into public.visitor_profiles (
    profile_id, buyer_type, interests_segments, interests_destinations,
    interests_destinations_free, interests_services, demand_profile, notes,
    portfolio_pt, portfolio_es, consent_data_sharing, consent_data_sharing_at, consent_marketing,
    additional_contacts
  ) values (
    v_profile_id,
    nullif(btrim(coalesce(p_payload->>'buyer_type','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_segments','[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_destinations','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'interests_destinations_free','')), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'interests_services','[]'::jsonb))), '{}'),
    nullif(btrim(coalesce(p_payload->>'demand_profile','')), ''),
    nullif(btrim(coalesce(p_payload->>'notes','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_pt','')), ''),
    nullif(btrim(coalesce(p_payload->>'portfolio_es','')), ''),
    true, now(), coalesce((p_payload->>'consent_marketing')::boolean, false),
    coalesce(p_payload->'additional_contacts', '[]'::jsonb)
  )
  on conflict (profile_id) do update set
    buyer_type = excluded.buyer_type,
    interests_segments = excluded.interests_segments,
    interests_destinations = excluded.interests_destinations,
    interests_destinations_free = excluded.interests_destinations_free,
    interests_services = excluded.interests_services,
    demand_profile = excluded.demand_profile,
    notes = excluded.notes,
    portfolio_pt = excluded.portfolio_pt,
    portfolio_es = excluded.portfolio_es,
    consent_data_sharing = true,
    consent_data_sharing_at = now(),
    consent_marketing = excluded.consent_marketing,
    additional_contacts = excluded.additional_contacts;
  return v_company_id;
end;
$function$;
