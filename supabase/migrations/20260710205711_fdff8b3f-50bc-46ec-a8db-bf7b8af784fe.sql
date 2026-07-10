
ALTER TABLE public.site_configs
  ADD COLUMN IF NOT EXISTS theme_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed PromPerú com os tokens atualmente hardcoded em src/styles.css,
-- convertidos para hex, para que o site atual continue idêntico.
UPDATE public.site_configs
SET theme_tokens = jsonb_build_object(
      'primary',            '#D52B1E',
      'primaryForeground',  '#FFFFFF',
      'secondary',          '#F5F5F5',
      'secondaryForeground','#111111',
      'accent',             '#FDECEA',
      'accentForeground',   '#8A1A12',
      'background',         '#FFFFFF',
      'foreground',         '#111111',
      'card',               '#FFFFFF',
      'muted',              '#F2F2F2',
      'mutedForeground',    '#6E6E6E',
      'border',             '#E5E5E5'
    )
WHERE theme_tokens = '{}'::jsonb;
