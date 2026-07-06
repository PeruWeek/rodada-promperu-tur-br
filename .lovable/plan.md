# Ocultar CTA de agendamento para expositores lotados

## Objetivo
Impedir que o visitante veja o botão de agendamento quando o expositor não tem mais nenhum slot livre, mantendo o acesso ao perfil. A decisão vem de dado real (mesa do evento ativo + `time_slots.is_active` − `meetings.status='scheduled'`), calculado já na listagem/detalhe — sem esperar o clique no `BookingDialog`.

## Regra canônica de disponibilidade
Um slot está ocupado quando existe qualquer `meetings` com `status='scheduled'` em `(table_id, slot_id)` (consistente com `listVisitorBookingSlots` e com a regra "1 slot = 1 empresa"). O expositor está "lotado" quando:

- existe `event_tables` do expositor **no evento ativo**, e
- `count(time_slots.is_active=true) − count(distinct slot_id em meetings scheduled da mesma mesa) = 0`.

Sem mesa no evento ativo ou sem slots ativos → `available_slots_count = 0`.

## Backend (1 migração — ajusta 2 RPCs)

### `public.public_exhibitor_catalog(_event_id uuid default null)`
Adicionar coluna `available_slots_count int` ao RETURNS TABLE. `et` já está escopado por `v_event`; subquery:

```sql
(SELECT COUNT(*)::int
   FROM public.time_slots ts
  WHERE ts.table_id = et.id
    AND ts.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.meetings m
       WHERE m.table_id = et.id
         AND m.slot_id  = ts.id
         AND m.status   = 'scheduled'
    )) AS available_slots_count
```

### `public.public_exhibitor_detail(_profile_id uuid, _event_id uuid default null)`
**Ajuste obrigatório**: `available_slots_count` precisa ser calculado **no escopo do evento ativo**, não em qualquer mesa do expositor. Mudanças:

1. Assinatura: adicionar `_event_id uuid default null`.
2. Corpo: `v_event := COALESCE(_event_id, public.pipeline_active_event_id())`.
3. Trocar a linguagem para `plpgsql` (para usar a variável) e manter `STABLE SECURITY DEFINER SET search_path=public`.
4. Restringir o `LEFT JOIN public.event_tables et`: `ON et.exhibitor_profile_id = p.id AND et.event_id = v_event`.
5. Adicionar `available_slots_count int` no RETURNS TABLE, com a mesma subquery acima (retorna 0 quando `et.id IS NULL`, via `COALESCE`).
6. Manter GRANTs atuais (`REVOKE ... FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`) — recriar após `DROP FUNCTION` porque a assinatura muda.

Nenhuma tabela nova. Nenhuma alteração em RLS ou GRANTs de tabela.

## Types

`src/integrations/supabase/types.ts` (arquivo auto-gerado — será regenerado após a migração) precisa refletir a nova coluna nos `Returns` de:

- `public_exhibitor_catalog`: acrescentar `available_slots_count: number` no objeto Returns.
- `public_exhibitor_detail`: acrescentar `available_slots_count: number` no objeto Returns e `_event_id?: string` nos `Args`.

Como o arquivo é regenerado automaticamente pela integração Supabase após a migração ser aprovada, o passo é: aplicar a migração → confirmar que `types.ts` foi regenerado com as colunas → seguir para o frontend. Se a regeneração automática não incluir, aplicar manualmente o patch mínimo nos dois blocos `Returns`/`Args` acima.

## Frontend

### `src/components/exhibitor-card.tsx`
- Adicionar `available_slots_count: number` em `ExhibitorListItem`.
- Se `> 0`: CTA atual `explore.viewProfileAndSchedule`.
- Se `= 0`: CTA neutro `Ver perfil` (`explore.viewProfileOnly`) apontando para `/exhibitor/$id`, e `Badge` `Agenda lotada` (`explore.fullyBooked`).

### `src/routes/_authenticated/explore.tsx`
Mapear na `queryFn`:
```ts
available_slots_count: r.available_slots_count ?? 0,
```
Nada mais muda (sem novo filtro/ordem).

### `src/routes/_authenticated/exhibitor.$id.tsx`
- Ler `available_slots_count` do RPC.
- Renderizar `<BookingDialog>` só quando `canBook && available_slots_count > 0`.
- Caso contrário, exibir badge `Agenda lotada` no lugar.

### i18n
`src/lib/i18n/pt-BR.json` e `es.json`:
- `explore.viewProfileOnly` → "Ver perfil" / "Ver perfil"
- `explore.fullyBooked` → "Agenda lotada" / "Agenda completa"

## `BookingDialog`
Sem alterações — segue como proteção secundária contra corrida.

## Fora do escopo
Regras de booking, triggers, constraints, esconder perfil, admin, exportações.

## Evidências finais
- Diff das duas RPCs (assinatura + subquery `available_slots_count` + escopo por `v_event`).
- Diff de `types.ts` (novas propriedades em `Returns`/`Args`).
- Arquivos alterados: migração, `types.ts`, `explore.tsx`, `exhibitor-card.tsx`, `exhibitor.$id.tsx`, `i18n/pt-BR.json`, `i18n/es.json`.
- Validação SQL:
  - `SELECT profile_id, available_slots_count FROM public.public_exhibitor_catalog();`
  - `SELECT profile_id, available_slots_count FROM public.public_exhibitor_detail('<id lotado>');` → 0
  - `SELECT profile_id, available_slots_count FROM public.public_exhibitor_detail('<id com vaga>');` → > 0
- Screenshots/descrição: card lotado (CTA "Ver perfil" + badge) vs disponível (CTA agendamento); detalhe lotado sem `BookingDialog` vs detalhe com vaga com `BookingDialog`.
