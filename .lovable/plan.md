
## Diagnóstico

`listCheckinEligible` filtra por `company_event_pipeline.registration_status IN ('cadastro_concluido','aprovado')`. No banco, as 201 linhas de pipeline estão em `em_preenchimento`, então o filtro zera qualquer busca. Além disso o `.or()` só bate em `full_name` e `email` — digitar empresa nunca acha ninguém.

## Contrato de retorno (preservado)

Mantém exatamente o shape atual: `{ eventId, profiles }`. Cada item de `profiles` mantém `id`, `auth_user_id`, `full_name`, `email`, `company_id`, `company`. **Única adição**: novo campo opcional `pipeline_status: string | null` por perfil. Nenhum campo removido, nenhum renomeado — zero quebra no frontend.

## Mudanças

### `src/lib/checkin.functions.ts` — reescrever `listCheckinEligible`

Elegibilidade = **presença operacional no evento**, união de três fontes:

1. `visitor_profile_id` de `meetings` com status `scheduled | done | no_show`;
2. `exhibitor_profile_id` das `event_tables` referenciadas por essas reuniões;
3. `exhibitor_profile_id` titular de **qualquer** `event_tables` do evento (mesmo sem reunião).

Handler:

- Em paralelo: `meetings` do evento (status ativo) + todas as `event_tables` do evento.
- Montar `candidateIds = visitorIds ∪ exhibitorIds`; safety net para reuniões cuja mesa não veio no primeiro lote.
- Se `candidateIds` vazio → retorno cedo com `profiles: []`.
- Carregar `profiles` via `IN (candidateIds)` — dedup natural por `profiles.id` (Map).
- Buscar `companies.trade_name` por lote.
- Buscar `company_event_pipeline.registration_status` por lote — **apenas informativo** (`pipeline_status`).
- Busca livre **em memória**, depois do merge, sobre `full_name | email | trade_name`, com `trim` + `toLowerCase`. Sem `.or()` no PostgREST.
- `limit` (padrão 500) aplicado **só quando não há termo de busca**.

### `src/routes/_authenticated/admin.tsx` — `CheckinTab`

- Placeholder: `t("admin.checkin.searchPlaceholder")` → “Buscar por nome, e-mail ou empresa…”.
- Estados vazios distintos:
  - `!data?.event` → `t("admin.checkin.noEvent")`;
  - evento existe, `profiles=[]`, sem `q` → `t("admin.checkin.emptyEvent")`;
  - `profiles=[]` com `q` preenchido → `t("admin.checkin.noResults")` (já existente).
- Se `p.pipeline_status`, badge discreto ao lado do nome com `t("admin.checkin.pipelineStatus." + status, { defaultValue: status })`. Não bloqueia o botão “Marcar chegada”.

### `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json`

Dentro de `admin.checkin`:

- `searchPlaceholder`: “Buscar por nome, e-mail ou empresa…” / “Buscar por nombre, email o empresa…”
- `noEvent`: “Nenhum evento ativo encontrado.” / “Ningún evento activo encontrado.”
- `emptyEvent`: “Nenhum participante elegível para este evento ainda.” / “Aún no hay participantes elegibles para este evento.”
- `pipelineStatus`:
  - `em_preenchimento` — “Cadastro em preenchimento” / “Registro en curso”
  - `cadastro_concluido` — “Cadastro concluído” / “Registro concluido”
  - `aguardando_aprovacao` — “Aguardando aprovação” / “Esperando aprobación”
  - `aprovado` — “Aprovado” / “Aprobado”
  - `bloqueado` — “Bloqueado” / “Bloqueado”
- Fallback: `defaultValue: status` para status não mapeados.

## Fora de escopo

`generalCheckIn`, `meetingCheckIn`, RLS, migrations, pipeline comercial, aprovações, mesas/slots.

## Critérios de aceite

- Shape de retorno preservado; apenas `pipeline_status` foi adicionado.
- Buscar por parte do nome, do e-mail ou do nome da empresa retorna elegíveis.
- Expositor titular de mesa sem reunião marcada aparece.
- Empresa em `em_preenchimento` não é excluída (aparece com badge informativo).
- Sem duplicados por `profiles.id`.
- Estados vazios distintos entre sem evento, evento sem elegíveis e busca sem match.
- Marcar chegada continua funcionando (sem alteração em `generalCheckIn`).
