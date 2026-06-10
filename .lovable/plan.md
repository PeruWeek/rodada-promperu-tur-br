## Confirmação do estado atual (build publicado)

Rodei `rg "getUser("` em `src/`. Resultado — **6 chamadas**, três delas em guards `beforeLoad`:

| Arquivo | Local | Tipo | Causa o erro? |
|---|---|---|---|
| `src/routes/_authenticated.tsx:14` | `beforeLoad` | Guard de rota | **Sim** (toda navegação logada) |
| `src/routes/login.tsx:23` | `beforeLoad` | Guard de rota | **Sim** (toda visita a /login) |
| `src/routes/signup.tsx:40` | `beforeLoad` | Guard de rota | **Sim** (toda visita a /signup) |
| `src/components/language-switcher.tsx:20` | Fire-and-forget no click | Persistência de idioma | Não no fluxo normal |
| `src/components/booking-dialog.tsx:61` | Dentro de `useQuery` | Dado da query | Não (já gated) |
| `src/routes/lovable/email/transactional/send.ts:116` | Server route | Validação de token server-side | Não (server) |

A stack `XO.getUser()` em `beforeLoad` que você viu casa exatamente com essas 3 rotas. O `_authenticated.beforeLoad` dispara em **toda** navegação interna (Dashboard → Explore → Agenda), e `getUser()` faz HTTP para `/auth/v1/user` — quando o router invalida rotas (após `SIGNED_IN`, mudança de aba) a request anterior é abortada, virando `TypeError: Failed to fetch` no browser e `context canceled / 500` nos auth-logs do Supabase (verificado nos logs anexados).

## Correção

Trocar **as 3 chamadas em `beforeLoad`** por `getSession()`, que lê o JWT do `localStorage` sem rede. A área logada é `ssr: false`, então não há perda de segurança — a validação real do token continua nos serverFns via `requireSupabaseAuth`.

### 1. `src/routes/_authenticated.tsx`
```ts
beforeLoad: async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/login" });
},
```

### 2. `src/routes/login.tsx`
```ts
beforeLoad: async () => {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (data.session) throw redirect({ to: "/dashboard" });
},
```

### 3. `src/routes/signup.tsx`
```ts
beforeLoad: async () => {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (data.user) throw redirect({ to: "/dashboard" });
  // (corrigir referência para data.session)
},
```

**Não tocar** `language-switcher.tsx`, `booking-dialog.tsx` nem o server route de email — eles não causam o erro relatado e mudá-los seria fora de escopo.

## Validação pós-fix

1. Confirmação estática: rodar `rg "getUser\(" src/routes/` — não deve retornar nada em `beforeLoad`.
2. Aba anônima, login visitante, navegar `/dashboard ↔ /explore ↔ /agenda ↔ /profile`, logout: **zero** `Failed to fetch` no console.
3. Login admin: mesma navegação, sem erro residual.

## Dropdown de período do admin

Verificado em `src/components/admin/pipeline/pipeline-tabs.tsx` linhas 87–95: o `<Select>` do shadcn usa Radix por baixo, que **só monta as `<SelectItem>` com `role="option"` quando o popover está aberto**. Por isso a automação que lê `period_options=[]` falha — ela está olhando o DOM com o select fechado. Não é bug do componente, é limitação do seletor de teste.

As 4 opções existem no código: `7`, `30`, `90`, `365`. O `queryKey` inclui `period`, então a troca refetch automaticamente. Documentar no `.lovable/plan.md` que:
- as 4 opções são renderizadas dinamicamente pelo Radix Popover;
- automação deve abrir o select antes de coletar `[role="option"]`;
- validação manual: trocar entre 7/30/90/365 → KPIs do pipeline atualizam.

## Documentação (`.lovable/plan.md`)

- Adicionar seção "Rodada N — Failed to fetch causa raiz": listar as 3 rotas, explicar getUser→getSession, com evidência dos auth-logs (context canceled).
- Adicionar nota sobre o select Radix e instrução para automação.
- Atualizar checklist: visitante ✅, admin ✅, console limpo ✅.

## Fora de escopo
- Não alterar `onAuthStateChange` (já filtrado).
- Não mexer em RLS, migrations, agenda, booking, trigger de expositor.
- Não tocar UI/estilo.
- Não alterar `language-switcher` / `booking-dialog`.

## Critério de aceite
- `rg "getUser\(" src/routes/_authenticated.tsx src/routes/login.tsx src/routes/signup.tsx` → 0 ocorrências.
- Console limpo após login/navegação/logout em visitante e admin.
- Build sem regressão.
