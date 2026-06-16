# Promoção de Pré-cadastro com fila de Revisão

## Regra de negócio

Pré-cadastro vira cadastro final automaticamente apenas quando o match é **único e confiável**. Em qualquer ambiguidade, o registro entra na fila de **Revisão** no Admin, com motivo explícito, sem promoção automática.

### Match único e confiável (auto-promove)
- Existe **exatamente 1** pré-cadastro pendente com o e-mail informado, **e**
- Existe **exatamente 1** pré-cadastro com o CNPJ informado (quando há CNPJ), **e**
- Os dois apontam para o mesmo registro, **e**
- Não há divergência relevante entre pré-cadastro e formulário.

### Vai para Revisão (não auto-promove)
Motivos possíveis, gravados como tags:
- `email_duplicado` — 2+ pré-cadastros pendentes com o mesmo e-mail
- `cnpj_duplicado` — 2+ pré-cadastros com o mesmo CNPJ
- `dados_divergentes` — CNPJ do form ≠ CNPJ do pré-cadastro, **ou** razão social com similaridade < 80%, **ou** país diferente
- `dado_critico_ausente` — empresa BR sem CNPJ nem no pré-cadastro nem no form

## Mudanças

### 1. Schema (migration)
Adicionar em `public.profiles`:
- `review_status` enum `none | needs_review | resolved` (default `none`)
- `review_reasons text[]` (default `{}`)
- `review_payload jsonb` — snapshot do form e dos candidatos detectados, para o admin auditar
- `review_created_at`, `review_resolved_at`, `review_resolved_by` (FK profiles)

Novas funções SQL:
- `pre_reg_match_quality(p_email, p_tax_id, p_country_code) → jsonb` — retorna `{unique: bool, reasons: text[], candidate_profile_ids: uuid[]}`. Usada pelo trigger e pelas RPCs.
- `pre_reg_similarity(text, text) → numeric` — wrapper sobre `similarity()` (pg_trgm já instalada? se não, habilitar) para a checagem de razão social.

### 2. Trigger `handle_new_user()` (gatilho 1: signup)
Alterar para:
- Contar pendentes pelo e-mail. Se **= 1**, claim normal (como hoje). Se **> 1**, criar um profile novo `pending_signup=false, auth_user_id=new.id, review_status='needs_review', review_reasons=['email_duplicado']`, sem mexer nos pendentes — admin resolve depois.
- Se **= 0**, criar profile novo normal (como hoje).

### 3. `complete_buyer_signup` RPC e `completeExhibitorSignup` server fn (gatilho 2: form final)
Antes de gravar company/profile, rodar `pre_reg_match_quality` com `{email, tax_id, country_code}` do form + comparar com o pré-cadastro reivindicado:
- Se a função retornar `unique: true` **e** o diff form↔pré-cadastro não bater nenhuma regra de divergência → gravar normalmente (auto-promoção).
- Caso contrário → gravar os dados do form num registro próprio (sem tocar no pré-cadastro original), marcar `review_status='needs_review'` com `review_reasons` e snapshot completo em `review_payload`. O usuário continua o fluxo normalmente; o admin decide depois.

Regras de divergência (todas bloqueiam):
- `tax_id` informado no form ≠ `tax_id` no pré-cadastro vinculado
- `similarity(trade_name_form, trade_name_pre) < 0.80` E `similarity(legal_name_form, legal_name_pre) < 0.80`
- `country_code` diferente

Dado crítico ausente: `country_code='BR'` e nenhum `tax_id` em nenhum dos dois lados → `dado_critico_ausente`.

### 4. Nova aba "Revisão" no Admin
Arquivo novo `src/components/admin/review-queue-tab.tsx`, plugado em `src/routes/_authenticated/admin.tsx` entre `requests` e `preRegistration`.

Tela mostra tabela com: data, e-mail, nome, empresa, motivo(s) (badges coloridos), candidatos detectados. Drawer de detalhe com snapshot lado-a-lado (pré-cadastro × form) e quatro ações:
- **Vincular ao pré-cadastro correto** — escolher 1 dos candidatos; copia `auth_user_id` para o pré-cadastro, descarta o profile novo, transfere `company_id` se houver.
- **Mesclar registros** — funde campos vazios do pré-cadastro com os do form (estratégia "form ganha quando preenchido"), apaga o profile duplicado.
- **Manter separados** — só limpa `review_status='resolved'`, deixa os dois registros existindo.
- **Descartar duplicado** — soft delete do profile sob revisão (`is_active=false`), grava motivo no audit.

Cada ação chama uma server fn dedicada (`resolveReviewLink`, `resolveReviewMerge`, `resolveReviewKeep`, `resolveReviewDiscard`) com `requireSupabaseAuth` + checagem `has_role(...,'admin')`, grava em `audit_logs`.

### 5. Filtro na aba Pré-cadastros
Pequeno badge no header ("3 registros aguardando revisão →") com link pra nova aba, para visibilidade.

### 6. i18n
Adicionar chaves em `pt-BR.json` e `es.json` para nomes da aba, motivos, ações, mensagens.

## Critérios de aceite
- E-mail único + CNPJ único + sem divergência → auto-promove (igual hoje).
- 2 pré-cadastros mesmo e-mail → ambos ficam intactos; o novo signup cai em Revisão com `email_duplicado`.
- CNPJ do form difere do pré-cadastro → Revisão com `dados_divergentes`, pré-cadastro original não é sobrescrito.
- Empresa BR sem CNPJ em nenhum lado → Revisão com `dado_critico_ausente`.
- Admin vê motivo, snapshot e candidatos; resolve com 1 clique; ação fica no `audit_logs`.
- Telas existentes (Empresas, Agendamentos do perfil Cliente) continuam filtrando só registros já efetivamente cadastrados (mantém o filtro atual `auth_user_id IS NOT NULL AND pending_signup=false`); registros em `needs_review` permanecem fora até o admin resolver.

## Notas técnicas
- `pg_trgm` precisa estar habilitada (`CREATE EXTENSION IF NOT EXISTS pg_trgm`).
- O índice parcial `profiles_pending_email_unique` continua válido — `email_duplicado` só aparece quando alguém tentou contornar (ex.: importações concorrentes).
- Trigger e RPCs gravam o snapshot completo em `review_payload` para o admin não precisar reconstruir o estado.
- Server fns de resolução são privilegiadas: `requireSupabaseAuth` + `has_role(auth.uid(),'admin')`; carregam `supabaseAdmin` via `await import(...)` dentro do handler.
- Sem mudança nos exports do perfil `Cliente` — eles continuam usando o mesmo filtro de "cadastro efetivo".
