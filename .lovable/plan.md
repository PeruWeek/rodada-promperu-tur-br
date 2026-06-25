## Problema

`checkSignupAvailability` retorna `cnpj_taken = true` para qualquer empresa em `companies` com aquele `tax_id`, incluindo pré-cadastros pendentes (profiles com `auth_user_id IS NULL`), bloqueando signup legítimo. Em paralelo, `complete_buyer_signup` faz `INSERT` em `companies` sempre que o profile não tem `company_id`, podendo violar o índice único de `tax_id`.

## Mudanças

### 1. `src/lib/signup-availability.functions.ts`

Substituir a checagem booleana por classificação. Dado o e-mail e o CNPJ (`digits-only`) do input:

- Buscar `companies` cujo `regexp_replace(tax_id, '\D', '', 'g')` bate com o CNPJ normalizado.
- Inspecionar todos os profiles ligados a essas empresas e classificar com **precedência estrita**:
  1. **`claimed`** — existe ao menos um profile com `auth_user_id IS NOT NULL`. Vence sempre.
  2. **`pending_same_email`** — não é `claimed`, e ao menos um profile pendente (`auth_user_id IS NULL`) tem `email` (case-insensitive) igual ao e-mail digitado.
  3. **`pending_other_email`** — não é `claimed` nem `pending_same_email`, e há pelo menos um profile pendente.
  4. **`free`** — nenhuma empresa encontrada.

Retorno:

```ts
{
  email_taken: boolean,
  cnpj_taken: boolean,                // true SOMENTE quando cnpj_status === 'claimed'
  cnpj_status: 'free' | 'claimed' | 'pending_same_email' | 'pending_other_email'
}
```

`email_taken` permanece como hoje.

### 2. `src/routes/signup.tsx`

No bloco do pré-check (linhas ~276–303):

- `claimed` → manter comportamento atual: `toast.error`, registrar evento `signup_duplicate_cnpj`, setar erro em `tax_id`, bloquear avanço.
- `pending_same_email` → seguir normalmente; sem toast, sem erro de campo.
- `pending_other_email` → seguir normalmente; `toast.info` neutro ("Encontramos um pré-cadastro com este CNPJ — vincularemos automaticamente após análise.").
- `free` → fluxo normal.
- `email_taken` permanece inalterado.

Nenhuma outra alteração nesse arquivo.

### 3. Nova migration `supabase/migrations/<timestamp>_complete_buyer_signup_reuse_pending_cnpj.sql`

`CREATE OR REPLACE FUNCTION public.complete_buyer_signup` reutilizando a versão atual. No branch `IF v_existing_company IS NULL`, antes de qualquer `INSERT`:

1. Se `v_tax_id IS NOT NULL`, calcular `v_tax_digits := regexp_replace(v_tax_id, '\D', '', 'g')` e, se não vazio, buscar:

   ```sql
   SELECT id INTO v_found_company
   FROM public.companies
   WHERE regexp_replace(coalesce(tax_id,''), '\D', '', 'g') = v_tax_digits
   LIMIT 1;
   ```

2. Se encontrou empresa:
   - **Defesa em profundidade (`claimed`)**: se existir profile vinculado a essa company com `auth_user_id IS NOT NULL` (excluindo o profile corrente), `RAISE EXCEPTION 'cnpj_already_claimed'`. Não vincular silenciosamente.
   - Caso contrário, reutilizar a empresa (`v_company_id := v_found_company`) e aplicar o mesmo `UPDATE public.companies SET ...` já usado hoje no ramo "empresa existente".
   - **Mismatch de e-mail (com precedência correta para evitar falso-positivo)**: ler o e-mail do profile atual (`v_current_email`) e os e-mails dos profiles pendentes ligados à empresa reutilizada (`auth_user_id IS NULL`, excluindo o profile corrente). Definir flags:
     - `v_has_pending := count(*) > 0`
     - `v_has_pending_same_email := exists(... lower(email) = lower(v_current_email) ...)`
     - `v_has_pending_other_email := exists(... lower(email) <> lower(v_current_email) ...)`
     
     Marcar `cnpj_pre_reg_email_mismatch` **apenas quando** `v_has_pending = true` AND `v_has_pending_same_email = false` AND `v_has_pending_other_email = true`. Isso espelha exatamente a precedência `claimed > pending_same_email > pending_other_email > free` e evita marcar review quando há um pendente com o mesmo e-mail mesmo que outros sejam diferentes.

3. Se não encontrou: seguir com o `INSERT INTO public.companies (...)` atual.

**Regras para `review_reasons`** (afeta tanto o bloco já existente de `pre_reg_match_quality` quanto o novo reason):

- Não sobrescrever motivos preexistentes em `profiles.review_reasons`.
- Fazer merge: `existing ∪ pre_reg_reasons ∪ (cnpj_pre_reg_email_mismatch quando aplicável)`, deduplicado via `array(SELECT DISTINCT unnest(...))`.
- Preservar `review_created_at` via `COALESCE`.
- `review_payload` mantém formato atual, opcionalmente acrescentando `reused_company_id` quando a empresa for reutilizada.
- `review_status` só passa para `needs_review` quando o array final de reasons não estiver vazio.

Restante da função (UPDATE em `profiles` com `company_id = v_company_id`, INSERT/UPSERT em `visitor_profiles`, validações de obrigatoriedade, idioma, lunch participation) permanece idêntico.

## Critérios de aceite

1. CNPJ inédito → cria empresa nova; sem erros.
2. Pré-cadastro pendente, e-mail igual → reutiliza empresa; sem duplicidade; sem violar índice único; profile **não** vai para review por esse motivo.
3. Pré-cadastro pendente, e-mail diferente (único pendente) → reutiliza empresa; profile fica `needs_review` com reason `cnpj_pre_reg_email_mismatch` mesclada às existentes.
4. **Vários pré-cadastros pendentes, um com mesmo e-mail e outros com e-mails diferentes** → reutiliza empresa; profile **não** vai para review por mismatch (precedência `pending_same_email`).
5. CNPJ de empresa com conta ativa → pré-check bloqueia com toast de duplicado; se chegar ao RPC, lança `cnpj_already_claimed`.
6. Nenhum erro de `unique` em `companies.tax_id` nos cenários acima.

## Fora do escopo

Não tocar em onboarding, profile, listagens admin, pipeline ou qualquer outro fluxo. Sem refatoração paralela. Manter compatibilidade do retorno `cnpj_taken` (continua booleano para consumidores existentes).