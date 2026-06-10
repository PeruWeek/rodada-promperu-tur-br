## Diagnóstico (confirmado no código)

"Expositor" não é entidade própria — é o papel `app_role='exhibitor'` aplicado a um usuário. CRUD já existe, espalhado em 4 abas:

| Operação | Local atual | Server fn / trigger |
|---|---|---|
| Criar manualmente | **Usuários** → "Novo usuário" → papel=Exhibitor | `adminCreateConfirmedUser` + trigger `ensure_exhibitor_profile_on_role` |
| Importar em massa | **Pré-cadastros** → CSV | `importPreRegistrationsCsv` |
| Aprovar pedido externo | **Solicitações** | `reviewExhibitorRequest` |
| Editar empresa + ficha exhibitor | **Empresas** → "Editar" | `updateCompanyFull` |
| Editar usuário (nome, papel, idioma, ativo, empresa) | **Usuários** → lápis | `adminUpdateUserProfile` + `adminSetPrimaryRole` |
| Inativar (soft) | **Usuários** → editar → switch `is_active` | `adminUpdateUserProfile` |
| Excluir físico (admin) | **Usuários** → lixeira | `adminDeleteUser` (cascade) |

**Causa da ambiguidade:** abas nomeadas por entidade/workflow, nenhuma chamada "Expositores". Operador procura "Novo expositor" e não acha — o caminho é "Usuários → Novo → papel Exhibitor".

## Regra de negócio (documentar)

1. Criação manual: Usuários → Novo (papel Exhibitor). Cria auth user confirmado + profile + `exhibitor_profiles` (trigger).
2. Criação por importação: Pré-cadastros CSV. Auth user real só na confirmação do convite.
3. Edição: dados pessoais/papel → Usuários (lápis); ficha comercial (segmentos, pitch, materiais) → Empresas (Editar).
4. Exclusão física: só admin, Usuários (lixeira), cascade.
5. Inativação (soft): switch `is_active` no editar usuário.

## Mudanças (escopo mínimo, sem regras novas)

**1. Discoverable em Usuários**
- Filtro/chip de papel "Todos / Admin / Staff / Exhibitor / Visitor" no topo da lista.
- Hint no topo: "Criar/editar/inativar/excluir expositores. Para ficha comercial (segmentos, pitch, materiais), use **Empresas**."
- No CreateUserDialog, legenda sob o seletor de papel: "Selecione 'Exhibitor' para criar um expositor."

**2. Hints nas outras abas**
- **Empresas**: "Editar dados cadastrais e ficha comercial. Para criar/excluir, vá em **Usuários**."
- **Pré-cadastros**: "Importação em massa. Conta real é criada quando o convite é confirmado. Para cadastro direto, use **Usuários**."

**3. Toggle Inativar/Ativar na linha** (Usuários)
Botão rápido ao lado da lixeira, chama `adminUpdateUserProfile({ is_active })`. Evita abrir o diálogo só para inativar.

**4. AlertDialog de exclusão reforçado**
Texto explícito: "Exclusão definitiva e em cascata. Para preservar histórico, use **Inativar**."

**5. Documentação `docs/admin-expositores.md`** (PT-BR)
Fluxos oficiais, mapa de operações, diferença inativar vs excluir, critérios QA.

## Arquivos

- `src/routes/_authenticated/admin.tsx` — filtro de papel + hints + toggle ativo/inativo + texto reforçado no AlertDialog.
- `src/components/admin/companies/companies-tab.tsx` — hint topo.
- `src/components/admin/pre-registrations-tab.tsx` — hint topo.
- `src/lib/i18n/pt-BR.json` + `src/lib/i18n/es.json` — strings novas.
- `docs/admin-expositores.md` — novo.
- `.lovable/plan.md` — registrar rodada.

## Fora de escopo

- Sem aba "Expositores" separada (papel é transversal).
- Sem nova entidade/tabela/migration/RLS/trigger.
- Sem mexer em visitante, agenda, booking, login.
- Sem novo endpoint — `adminCreateConfirmedUser` cobre.

## Critério de aceite

- Em Usuários, chip "Exhibitor" filtra a lista corretamente.
- "Novo usuário" tem hint sobre papel Exhibitor.
- Cada linha de usuário tem editar / ativar-inativar / excluir com tooltips claros.
- AlertDialog avisa que exclusão é definitiva e sugere inativar.
- Empresas, Pré-cadastros e Usuários mostram hint de escopo.
- `docs/admin-expositores.md` cobre cada operação com caminho UI e QA.
- Build limpo, sem regressão.