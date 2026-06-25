UPDATE public.companies
SET trade_name = 'AQUARELA AGENCIA',
    legal_name = 'COPASTUR'
WHERE trade_name ~* '^\s*aquarela\s*ag[eê]ncia\s*/\s*copastur\s*$'
   OR legal_name  ~* '^\s*aquarela\s*ag[eê]ncia\s*/\s*copastur\s*$';

UPDATE public.companies
SET trade_name = 'MEETS LIVE',
    legal_name = 'GRUPO AVIPAM'
WHERE trade_name ~* '^\s*meets\s*live\s*/\s*grupo\s*avipam\s*$'
   OR legal_name  ~* '^\s*meets\s*live\s*/\s*grupo\s*avipam\s*$';