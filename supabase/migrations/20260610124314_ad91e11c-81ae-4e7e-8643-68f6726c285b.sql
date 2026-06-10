
-- 1) Build mapping: for each (normalized trade_name, country_code, coalesce(state_code,'')),
--    pick canonical company id = oldest one.
CREATE TEMP TABLE _company_canonical ON COMMIT DROP AS
WITH grouped AS (
  SELECT
    id,
    lower(btrim(trade_name)) AS norm_name,
    coalesce(country_code,'') AS cc,
    coalesce(state_code,'') AS sc,
    created_at
  FROM public.companies
),
canon AS (
  SELECT norm_name, cc, sc, (array_agg(id ORDER BY created_at ASC, id ASC))[1] AS canonical_id
  FROM grouped
  GROUP BY norm_name, cc, sc
)
SELECT g.id AS dup_id, c.canonical_id
FROM grouped g
JOIN canon c ON c.norm_name=g.norm_name AND c.cc=g.cc AND c.sc=g.sc
WHERE g.id <> c.canonical_id;

-- 2) Repoint profiles to canonical company.
UPDATE public.profiles p
SET company_id = m.canonical_id
FROM _company_canonical m
WHERE p.company_id = m.dup_id;

-- 3) Consolidate company_event_pipeline rows: for any (event_id, dup_id),
--    if canonical already has a row for that event, keep canonical and delete dup row.
--    Otherwise, repoint dup row to canonical.
-- 3a) Delete duplicate pipeline rows where canonical already has one for the event.
DELETE FROM public.company_event_pipeline pip
USING _company_canonical m
WHERE pip.company_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM public.company_event_pipeline pip2
    WHERE pip2.event_id = pip.event_id AND pip2.company_id = m.canonical_id
  );

-- 3b) Repoint remaining pipeline rows to canonical.
UPDATE public.company_event_pipeline pip
SET company_id = m.canonical_id, updated_at = now()
FROM _company_canonical m
WHERE pip.company_id = m.dup_id;

-- 4) Delete now-orphan companies.
DELETE FROM public.companies c
USING _company_canonical m
WHERE c.id = m.dup_id
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.company_event_pipeline pip WHERE pip.company_id = c.id);

-- 5) Partial unique index to prevent future duplicates when tax_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS companies_unique_trade_when_no_tax
  ON public.companies (lower(btrim(trade_name)), coalesce(country_code,''), coalesce(state_code,''))
  WHERE tax_id IS NULL;
