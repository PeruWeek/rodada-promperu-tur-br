## Objetivo
Admin importa um CSV (mesmo formato do export atual) e o sistema cria `companies` + `profiles` + `visitor_profiles` + `company_event_pipeline` em estado `em_preenchimento`. No signup, o usuário preenche normalmente e, ao concluir, fazemos merge silencioso com o pré-cadastro pelo e-mail — sem endpoint público de lookup.

## Fluxo

```text
Admin ──upload CSV──▶ /admin "Pré-cadastros"
                       │
                       ▼
            importPreRegistrationsCsv()  (server fn, admin only)
                       │ por linha
                       ▼
   companies (upsert por CNPJ/RUC) ── profiles (upsert por lower(trim(email)))
                       │
                       ▼
   visitor_profiles + company_event_pipeline (status = em_preenchimento)
                       │
                       ▼
         Relatório: created | updated | skipped | error

Visitante ──signup completo──▶ claimPendingProfile() (server fn, autenticada)
                                       │
                                       ▼
              match por e-mail do JWT  ▶  vincula auth_user_id e marca pending_signup=false
                                       ▼
              merge: só preenche campos vazios; nunca sobrescreve
```

## Mudanças no banco (1 migração)

1. `profiles`:
   - `pending_signup boolean NOT NULL DEFAULT false`
   - índice único parcial: `lower(trim(email))` `WHERE email IS NOT NULL AND email <> '' AND auth_user_id IS NULL`  
     (mantém a regra atual de unicidade por `auth_user_id` intacta; só impede duas linhas pendentes para o mesmo e-mail)
   - trigger `BEFORE INSERT/UPDATE` para normalizar e-mail (`lower(trim(...))`)

2. `companies`:
   - índice único parcial em `tax_id` (CNPJ/RUC) `WHERE tax_id IS NOT NULL AND tax_id <> ''`  
     (linhas sem documento criam company nova — decisão do usuário)

3. `company_event_pipeline`:
   - garantir `UNIQUE (company_id, event_id)` se ainda não existe; import faz upsert por essa chave

4. Função `public.claim_pending_profile(p_auth_user_id uuid)` — `SECURITY DEFINER`, `search_path = public`:
   - **não aceita e-mail do cliente**; lê o e-mail via `auth.users` a partir de `p_auth_user_id`
   - valida `p_auth_user_id = auth.uid()` (chamada só faz sentido para o próprio usuário)
   - `SELECT ... FOR UPDATE` na linha de profile pendente
   - se achar profile com `auth_user_id IS NULL` e mesmo e-mail normalizado: define `auth_user_id`, `pending_signup = false`, e faz merge "só campos vazios" com os dados que o usuário acabou de gravar
   - retorna `{ matched: boolean, profile_id uuid | null }`

## Mudanças no código

### `src/lib/pre-registration.functions.ts` (novo)
- `importPreRegistrationsCsv({ csv: string, eventId: uuid })` — admin only (checa `has_role(uid, 'admin')` via serverFn middleware existente). Usa `supabaseAdmin`:
  - parse no servidor com `papaparse` (mesmo header do export)
  - validação Zod por linha (e-mail, telefone, campos obrigatórios mínimos)
  - normaliza: `trim`, e-mail lower, telefone só dígitos
  - upsert `companies` por `tax_id` (quando houver) — sem dedup quando vazio
  - upsert `profiles` por `lower(trim(email))` com `pending_signup=true, auth_user_id=null`
  - regra de conflito: **só preenche colunas onde valor atual é `NULL` ou `''`**; nunca sobrescreve
  - upsert `visitor_profiles` (FK profile) e `company_event_pipeline (company_id, event_id)` com `status='em_preenchimento'`
  - retorna sumário + por-linha: `created | updated | skipped_existing_filled | error` com mensagem

### `src/lib/signup.functions.ts` (novo) — `claimPendingProfile`
- serverFn autenticada (`requireSupabaseAuth`) que chama RPC `claim_pending_profile(auth.uid())`
- chamada no final do fluxo de signup, depois do `signUp` bem-sucedido, antes do primeiro redirect

### `src/routes/signup.tsx`
- **sem lookup público**: nenhum endpoint que receba e-mail anônimo
- após criar a conta, chama `claimPendingProfile()`; se `matched`, mostra toast "Encontramos seu pré-cadastro e vinculamos à sua conta"
- caso contrário, comportamento atual permanece igual

### `src/components/admin/pre-registrations-tab.tsx` (novo)
- nova aba no `/admin`: select de evento, upload `.csv` (limite 2 MB / 5k linhas), botão "Importar", tabela de resultado com filtro por status e botão "Baixar relatório CSV"
- valida MIME/extensão no client; servidor revalida tudo

### i18n
- chaves `admin.preRegistration.*` (pt-BR, es) e `signup.preRegistration.matched`

## Segurança (decisões fechadas)

- **Sem endpoint público de lookup por e-mail** → zero superfície de enumeração.
- `claim_pending_profile` nunca aceita e-mail do cliente; usa `auth.uid()` + `FOR UPDATE`.
- Import: admin only via middleware; tamanho/linhas limitados; parsing e validação no servidor (client só pré-visualiza).
- Normalização consistente (`lower(trim(...))`) garantida por trigger + índice na mesma expressão.
- Dedup de company por CNPJ/RUC quando houver; linhas sem documento criam company nova (aceito).
- Merge sempre conservador: preenche apenas campos vazios; valores já preenchidos pelo usuário no signup vencem.

## Fora de escopo
- Não cria `auth.users` em massa, não envia convites por e-mail, não aprova exhibitor automaticamente, sem captcha (não há endpoint público novo).
