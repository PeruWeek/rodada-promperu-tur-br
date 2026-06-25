## Escopo confirmado via inspeção do banco

Apenas 2 registros em `companies` têm valores concatenados:

| id | trade_name atual | legal_name atual |
|---|---|---|
| `694245f4-9ef4-464d-a595-1310694a9e6e` | `Copastur` | `Aquarela Agência/Copastur` |
| `a30b64e2-6aca-42fe-8cf1-a36538883199` | `Meets Live / Grupo Avipam` | `Meets Live / Grupo Avipam` |

Os demais `Copastur` (`2429b47f...`, `7093a861...`) **não** têm concatenação e ficam intactos.

Nenhum CSV `rodada_2026pr*.csv` existe no repositório — o item 5 do pedido não se aplica.

## Migration a criar

Arquivo: `supabase/migrations/<timestamp>_fix_concatenated_company_names.sql`

Lógica idempotente, restrita por padrões de concatenação (com/sem espaço na barra) em `trade_name` OU `legal_name`:

```sql
-- Aquarela / Copastur
UPDATE public.companies
SET trade_name = 'AQUARELA AGENCIA',
    legal_name = 'COPASTUR'
WHERE trade_name ~* '^\s*aquarela\s*ag[eê]ncia\s*/\s*copastur\s*$'
   OR legal_name  ~* '^\s*aquarela\s*ag[eê]ncia\s*/\s*copastur\s*$';

-- Meets Live / Grupo Avipam
UPDATE public.companies
SET trade_name = 'MEETS LIVE',
    legal_name = 'GRUPO AVIPAM'
WHERE trade_name ~* '^\s*meets\s*live\s*/\s*grupo\s*avipam\s*$'
   OR legal_name  ~* '^\s*meets\s*live\s*/\s*grupo\s*avipam\s*$';
```

- Idempotente: rodar de novo não muda nada (regex não casa mais após o UPDATE).
- Restrita: regex ancorada (`^...$`) atinge apenas as 2 linhas concatenadas; não afeta os outros `Copastur` nem qualquer empresa fora desse escopo.
- Sem mudança de schema, sem mudança de regra de negócio, sem mudança de UI/exportação.

## Validação esperada após aplicar

- Naline Correia (vinculada a `694245f4`) → `Empresa = AQUARELA AGENCIA`, `Razão social = COPASTUR`.
- Sandra Veloso (vinculada a `a30b64e2`) → `Empresa = MEETS LIVE`, `Razão social = GRUPO AVIPAM`.
- Demais contatos do mesmo `company_id` herdam a correção automaticamente (a coluna vem de `companies`).

## Entregáveis

- 1 arquivo de migration (nome com timestamp gerado na hora da aplicação).
- Nenhum arquivo de código/CSV alterado (CSVs operacionais citados não existem no repo).
- Ajuste seguro e restrito aos 2 registros identificados.