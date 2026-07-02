## Contexto
A entrega anterior já criou os arquivos base; este plano cobre apenas o delta de refino do gate do botão e da mensagem de agenda completa.

## Mudanças

### 1. `src/components/admin/registrants-tab.tsx`

**Probe global de disponibilidade**

Adicionar no topo do componente, antes do return:

```tsx
const listAvailabilityFn = useServerFn(listExhibitorAvailability);
const availabilityQuery = useQuery({
  queryKey: ["exhibitor-availability", "registrants-probe"],
  queryFn: () => listAvailabilityFn({ data: {} }),
  staleTime: 30_000,
});

const availabilityRows = (availabilityQuery.data?.rows ?? []) as ExhibitorAvailabilityRow[];

const hasAnyFreeSlot = useMemo(() => {
  return availabilityRows.some(
    (r) => r.status !== "lotada" && (r.free_slots?.length ?? 0) > 0
  );
}, [availabilityRows]);
```

**Novo gate do botão "Agendar"** — remover a condição `(r.profile_meetings_count ?? 0) === 0`. O botão agora aparece quando:

- `r.role === "visitor"`
- `!!r.auth_user_id`
- `r.is_active === true`
- `hasAnyFreeSlot === true`

**Banner "agenda completa"** — renderizar acima da lista quando:

```tsx
!availabilityQuery.isLoading &&
availabilityRows.length > 0 &&
!hasAnyFreeSlot
```

O uso de `availabilityRows.length > 0` em vez de `rows.length > 0` evita falso positivo quando a lista de inscritos tem itens mas a probe não carregou ou retornou vazia.

**Imports** — adicionar import de `listExhibitorAvailability` e do tipo `ExhibitorAvailabilityRow` de `@/lib/exhibitor-availability.functions`.

### 2. i18n

Adicionar em `admin.registrants.book`:

- pt-BR: `"agendaComplete": "Agenda operacional completa — não há mais horários livres em nenhuma expositora elegível."`
- es: `"agendaComplete": "Agenda operativa completa — no hay más horarios libres en ninguna expositora elegible."`

As demais chaves já foram adicionadas na entrega anterior.

### 3. Fluxo de status

- Badge continua governado por `bucketGroupFromMeetings(r.profile_meetings_count)`.
- Após sucesso do dialog: `BOOKING_INVALIDATE_KEYS` invalida `["exhibitor-availability", ...]`, refletindo no probe e sumindo do botão quando aplicável.

## Arquivos alterados
- `src/components/admin/registrants-tab.tsx`
- `src/lib/i18n/pt-BR.json`
- `src/lib/i18n/es.json`
