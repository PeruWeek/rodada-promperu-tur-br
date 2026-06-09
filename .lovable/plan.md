## Objetivo

Distinguir em todos os lugares pré-cadastros (sem login) de inscritos confirmados (já criaram conta no site). Sem migração; só leitura.

## Mudanças

### 1. Aba **Empresas** (admin/staff) — `src/lib/admin.functions.ts` + `src/components/admin/companies/companies-tab.tsx`

- Em `listAdminCompanies`, no `.select(...)` de `profiles`, incluir `auth_user_id`.
- Calcular por empresa: `hasConfirmedContact = algum profile com auth_user_id != null`.
- Retornar o flag no row (`confirmed: boolean`).
- Na UI da `CompaniesTab`:
  - Mostrar badge **"Pré-cadastro"** (variant outline/muted) quando `confirmed === false`, ao lado da badge de role.
  - Adicionar um filtro/Select **Status**: "Todos" (default) / "Confirmados" / "Pré-cadastro". Filtrar `rows` no servidor — adicionar param `confirmed?: 'all' | 'yes' | 'no'`.

### 2. **KPIs do Pipeline** (visíveis para staff/admin) — onde está "Total empresas"

Arquivo: backend dos KPIs (provavelmente `src/lib/pipeline.functions.ts`); ler para confirmar.

- Adicionar um KPI novo: **"Inscritos confirmados"** = empresas cujo `primary_profile_id` tem `auth_user_id != null`.
- Manter "Total empresas" e "Cadastros concluídos/incompletos" como estão (refletem pipeline, conceito diferente).

## Fora de escopo

- Pipeline/Kanban continua mostrando pré-cadastros (foi o propósito da importação).
- Aba "Inscritos" já foi corrigida na rodada anterior.

## Verificação

- Empresas: filtrar por "Pré-cadastro" deve listar só as importadas via CSV sem login criado; badge aparece nas linhas certas.
- KPIs: "Inscritos confirmados" ≤ "Total empresas"; cresce quando um pré-cadastrado completa o cadastro no site.