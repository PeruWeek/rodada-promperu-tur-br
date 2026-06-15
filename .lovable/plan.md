## Ajustes no formulário de visitante (revisado)

Aplicar 6 mudanças em **signup wizard (passo 4)**, **`/profile` aba Visitante** e **admin drawer aba Visitante**, mantendo paridade.

### 1. Renomear aba e título
- i18n `admin.companies.tabVisitor`: "Perfil de visitante" → **"Perfil da empresa"** (pt-BR e es).
- Mesma renomeação onde aparece como título da seção do passo 4 do signup e da aba do `/profile`.

### 2. `Tipo de comprador` → `Tipo de empresa` (multiseleção)
- i18n `signup.buyerType`: **"Tipo de empresa"** / "Tipo de empresa".
- Substituir o `<select>` único por `MultiSelectChips` com `taxonomyKey="buyer_types"` nas 3 telas. Continua obrigatório no signup (mínimo 1).

**Banco (nova migration):**
- `ALTER TABLE public.visitor_profiles ADD COLUMN buyer_types text[] NOT NULL DEFAULT '{}'`.
- Backfill: `UPDATE visitor_profiles SET buyer_types = ARRAY[buyer_type] WHERE buyer_type IS NOT NULL AND buyer_type <> ''`.
- Atualizar a função `public.complete_buyer_signup(p_payload jsonb)` (única RPC do fluxo, usada por `src/routes/onboarding.tsx` e `src/routes/signup.tsx`) para:
  - ler `p_payload->'buyer_types'` como `text[]` e gravar em `buyer_types`;
  - continuar gravando `buyer_type` com o primeiro item do array (compat com a view `match_pool_v` que expõe `visitor_buyer_type` e com o gate `consent_data_sharing AND buyer_type<>''` em `can_open_calendar`);
  - parar de ler `demand_profile` (gravar `null`).
- Após a migration aprovada, `src/integrations/supabase/types.ts` será regenerado automaticamente com a coluna `buyer_types: string[]` — nenhum edit manual.

### 3. Remover `Perfil de demanda`
Remover o campo das 3 telas e do payload:
- `src/routes/signup.tsx` (passo 4 e payload do `complete_buyer_signup`).
- `src/routes/_authenticated/profile.tsx` (state + `.upsert(...)` em `visitor_profiles`).
- `src/components/admin/companies/edit-company-drawer.tsx` (state, tab, save).
- `src/lib/validation/buyer-signup.schema.ts` (remover `demand_profile` do schema e do tipo).
- `src/lib/admin.functions.ts` (remover do schema Zod e do upsert).
- Coluna `demand_profile` permanece no banco (sem drop), mesmo padrão da remoção do `phone`.

### 4. Portfólio
- i18n `profile.portfolioPt`: **"Perfil da empresa"** / "Perfil de la empresa" (mantém a key).
- Remover o campo Portfólio (ES) das 3 telas e do save:
  - `src/routes/_authenticated/profile.tsx` (state + `.upsert(...)`).
  - `src/components/admin/companies/edit-company-drawer.tsx` (state, tab, save).
  - `src/lib/admin.functions.ts` (remover `portfolio_es` do schema Zod e do upsert).
- Coluna `portfolio_es` permanece no banco.

### 5. Destinos — remover opções
Em `src/lib/taxonomy.ts`, remover `machu_picchu` e `sacred_valley` de `destinations`. Valores já gravados continuam no banco; a renderização de chips antigos cai no fallback do `taxonomyLabel` (exibe o `value`) — aceitável.

### 6. Segmentos — adicionar opção
Em `src/lib/taxonomy.ts`, adicionar em `segments`:
`{ value: "sports_events", pt: "Eventos esportivos", es: "Eventos deportivos" }`.

### Atualização do `use-profile-completion`
Em `src/hooks/use-profile-completion.ts`, trocar `!!vis.buyer_type` por `Array.isArray(vis.buyer_types) && vis.buyer_types.length > 0`.

### Ordem de execução
1. **Migration** (`supabase--migration`): adiciona `buyer_types`, faz backfill, atualiza `complete_buyer_signup`. Aguarda aprovação. `types.ts` é regenerado.
2. **Front + libs**: aplica mudanças nos arquivos abaixo, todos já existentes.

### Arquivos afetados
- `supabase/migrations/<novo-timestamp>_visitor_buyer_types_array.sql` (nova)
- `src/integrations/supabase/types.ts` (regenerado pós-migration; não editar à mão)
- `src/lib/taxonomy.ts`
- `src/lib/validation/buyer-signup.schema.ts`
- `src/routes/signup.tsx`
- `src/routes/_authenticated/profile.tsx`
- `src/components/admin/companies/edit-company-drawer.tsx` *(arquivo existente confirmado)*
- `src/lib/admin.functions.ts`
- `src/hooks/use-profile-completion.ts` *(arquivo existente confirmado)*
- `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json`

### Fora de escopo
- Não dropar `demand_profile`, `portfolio_es` ou `buyer_type` (mantidos por compat com view de matching e dados históricos).
- Não alterar `target_buyers` do expositor.
- Não alterar wizard do expositor.
