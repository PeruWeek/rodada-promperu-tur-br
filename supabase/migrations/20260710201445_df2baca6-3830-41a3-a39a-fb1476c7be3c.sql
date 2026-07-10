-- 1. Table
CREATE TABLE public.site_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL UNIQUE,
  alt_hostnames TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_default BOOLEAN NOT NULL DEFAULT false,
  active_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  -- Branding
  name TEXT NOT NULL,
  tagline TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  -- SEO
  meta_description TEXT,
  og_image_url TEXT,
  -- URLs + Email
  site_url TEXT NOT NULL,
  email_from_name TEXT,
  email_from_address TEXT,
  email_reply_to TEXT,
  -- Textos institucionais
  footer_text TEXT,
  event_display_name TEXT,
  event_display_date TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Only one default
CREATE UNIQUE INDEX site_configs_only_one_default
  ON public.site_configs ((is_default))
  WHERE is_default = true;

-- 3. GRANTs (anon reads branding for public SEO; admins mutate via authenticated + policy)
GRANT SELECT ON public.site_configs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_configs TO authenticated;
GRANT ALL ON public.site_configs TO service_role;

-- 4. RLS
ALTER TABLE public.site_configs ENABLE ROW LEVEL SECURITY;

-- Public read (branding is public)
CREATE POLICY "site_configs public read"
  ON public.site_configs
  FOR SELECT
  USING (true);

-- Admin write
CREATE POLICY "site_configs admin write"
  ON public.site_configs
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. updated_at trigger (reuses existing function if present)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_site_configs_updated_at
  BEFORE UPDATE ON public.site_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Seed PromPerú as default
INSERT INTO public.site_configs (
  slug, hostname, alt_hostnames, is_default, active_event_id,
  name, tagline, logo_url, favicon_url, primary_color, secondary_color,
  meta_description, og_image_url,
  site_url, email_from_name, email_from_address, email_reply_to,
  footer_text, event_display_name, event_display_date
)
SELECT
  'promperu',
  'rodada.promperu.tur.br',
  ARRAY[
    'rodada-promperu-tur-br.lovable.app',
    'id-preview--9163060e-b183-4ce2-8782-e5a412537db3.lovable.app',
    'project--9163060e-b183-4ce2-8782-e5a412537db3.lovable.app',
    'project--9163060e-b183-4ce2-8782-e5a412537db3-dev.lovable.app'
  ],
  true,
  e.id,
  'PERU MICE Networking Evento',
  'Peru × Brasil',
  '/promperu-logo.png',
  '/favicon.ico',
  '#D52B1E',
  '#111111',
  'Plataforma oficial de matchmaking e agendamento da PERU MICE Networking Evento — Peru × Brasil. 08 de julho de 2026.',
  'https://rodada.promperu.tur.br/whatsapp-og.png',
  'https://rodada.promperu.tur.br',
  'PromPerú',
  'no-reply@rodada.promperu.tur.br',
  'contato@promperu.gob.pe',
  'Rodada de Negócios MICE · Peru × Brasil',
  'Rodada de Negócios MICE · Peru × Brasil',
  '08/07/2026'
FROM public.events e
WHERE e.name = 'Rodada Peru 2026'
LIMIT 1;