ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS qa_run_id text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS qa_run_id text;
CREATE INDEX IF NOT EXISTS profiles_qa_run_id_idx ON public.profiles(qa_run_id) WHERE qa_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS companies_qa_run_id_idx ON public.companies(qa_run_id) WHERE qa_run_id IS NOT NULL;