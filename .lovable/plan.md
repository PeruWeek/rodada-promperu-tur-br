## Diagnóstico

Rodei contagens no banco:

- `company_event_pipeline`: **658 linhas**, mas **0 pares duplicados** `(event_id, company_id)` → o pipeline em si não está repetido.
- `profiles`: **224 linhas, 224 emails únicos** → contatos NÃO estão sendo replicados (dedup por email funciona).
- `companies`: **658 linhas, apenas 137 trade_names distintos, 0 com tax_id** → empresas ESTÃO sendo replicadas. Cada import criou novas empresas idênticas (ex.: "Top Service" aparece 12 vezes, várias outras 9 vezes).

### Causa raiz

Em `src/lib/pre-registration.functions.ts`, a deduplicação de empresa só acontece quando o CSV traz `tax_id`:

```ts
if (taxId) {
  const { data: existing } = await supabaseAdmin
    .from("companies").select(...).eq("tax_id", taxId).maybeSingle();
  ...
}
if (!companyId) {
  // sempre INSERT — cria nova empresa toda vez
}
```

A lista importada está sem `tax_id` (CNPJ), então toda execução cria uma `company` nova e, em consequência, uma nova linha em `company_event_pipeline` para o mesmo evento. Os profiles são deduplicados por email corretamente, mas o `company_id` deles aponta para a primeira empresa criada — as réplicas posteriores ficam órfãs no pipeline.

## Correção

### 1. Deduplicar empresa também por nome quando não houver `tax_id`

Em `src/lib/pre-registration.functions.ts`, antes do `INSERT` de empresa:

- Se `tax_id` vier preenchido → manter lookup atual por `tax_id`.
- Se `tax_id` vazio → lookup por `lower(btrim(trade_name))` + `country_code` (+ `state_code` se preenchido), pegando a empresa mais antiga. Se achar, reutilizar o `id`. Só inserir nova empresa se nada bater.

Isso garante que reimportar a mesma lista N vezes não duplique empresa nem crie linhas adicionais no pipeline.

### 2. Limpeza dos dados já duplicados (one-shot migration)

Criar migração que:

- Para cada grupo `(trade_name normalizado, country_code, coalesce(state_code,''))` com mais de uma empresa: eleger a "canônica" (mais antiga / com mais profiles vinculados).
- Repontar `profiles.company_id`, `company_event_pipeline.company_id`, `event_tables`, `exhibitor_profiles` (via profile), e qualquer outra FK relevante para a canônica.
- Consolidar linhas de `company_event_pipeline` duplicadas no mesmo `(event_id, company_id)` mantendo a mais recente / mais completa.
- Apagar as `companies` órfãs.

Resultado esperado: `companies` cai de 658 → ~137 e `company_event_pipeline` para ~137 (1 por empresa no evento atual).

### 3. Reforço de integridade (opcional, recomendado)

Adicionar índice único parcial para travar regressão:

```sql
CREATE UNIQUE INDEX companies_unique_trade_when_no_tax
  ON public.companies (lower(btrim(trade_name)), country_code, coalesce(state_code,''))
  WHERE tax_id IS NULL;
```

Assim, mesmo que outro caminho de código tente inserir empresa duplicada sem CNPJ, o banco rejeita.

## Fora do escopo

- Mudar regra de dedup de profiles (já funciona: chave por email).
- Tocar fluxo de signup do expositor/visitante autoatendimento.
- Mexer em meetings, time_slots ou agenda.

## Validação manual após implementação

1. Rodar a migração de limpeza → conferir `SELECT count(*) FROM companies` ≈ 137 e `company_event_pipeline` ≈ 137.
2. Reimportar a MESMA planilha no admin → contagens devem permanecer iguais (0 novas empresas, 0 novas linhas no pipeline). Profiles também sem novas linhas.
3. Importar planilha com 1 contato novo (email novo) na mesma empresa → 0 novas empresas, +1 profile, 0 novas linhas no pipeline.
4. Importar contato com `tax_id` preenchido pela primeira vez → empresa existente deve receber o `tax_id` (patch já existente) sem criar duplicata.
