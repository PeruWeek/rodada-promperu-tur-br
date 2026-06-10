# Rodada de QA — Visitante / Admin / Expositor

## 1. Causa raiz e correções aplicadas

### Bloco A — Visitante: formulário "Entrar" continuava visível pós-login

**Causa raiz combinada:**

1. `__root.tsx` chamava `queryClient.invalidateQueries()` em **todos** os eventos de `onAuthStateChange` (inclusive `INITIAL_SESSION`, `TOKEN_REFRESHED`, `SIGNED_OUT`). Isso disparava refetch contra sessão limpa após logout (→ `TypeError: Failed to fetch` / 502) e contribuía para flashes de UI inconsistente.
2. `/login` chamava `navigate({to:"/dashboard"})` imediatamente após `signInWithPassword`, sem aguardar `router.invalidate()`. Resultado: por 1–2 frames o usuário via o formulário "Entrar" enquanto o header já mostrava "Sair".
3. Logout do `SiteHeader` não cancelava queries em voo nem limpava o cache antes do `signOut()` (não seguia o "Sign-Out Hygiene"). Isso somava 401/502 ao console.

**Correções aplicadas:**

- `src/routes/__root.tsx`: `onAuthStateChange` agora reage **apenas** a `SIGNED_IN`, `SIGNED_OUT`, `USER_UPDATED`; `invalidateQueries()` **nunca** roda em `SIGNED_OUT`; `router.invalidate()` sempre dispara para re-rodar os gates de rota.
- `src/routes/login.tsx`: após login bem-sucedido, esconde o formulário (mostra spinner "Entrando…"), aguarda `router.invalidate()`, e só então faz `navigate({to:"/dashboard", replace:true})`.
- `src/components/site-header.tsx`: `signOut()` agora segue a ordem canônica — `cancelQueries()` → `clear()` → `supabase.auth.signOut()` → `router.invalidate()` → `navigate({to:"/", replace:true})`.

### Bloco B — Admin: erros residuais de console

Mesma causa raiz do Bloco A (invalidação global + ausência de sign-out hygiene). As correções acima já eliminam o ciclo. Erros remanescentes que aparecerem agora são de fato endpoints específicos e devem ser tratados caso a caso.

### Bloco C — Expositor: revisão

**Bom achado:** o trigger de promoção de role **já existe** em `supabase/migrations/20260529230922_*.sql` (`handle_exhibitor_request_approved`): quando `exhibitor_requests.status` vira `approved`, insere `user_roles(role='exhibitor')` e cria a linha em `exhibitor_profiles`. Nenhuma migração nova foi necessária.

**Mapa do fluxo:**

- Sign-up → `requestExhibitorAccess` cria `exhibitor_requests(status='pending')`.
- Gate `_authenticated.tsx`: expositor com request `pending`/`rejected` é mandado para `/pending-exhibitor` (polling a cada 15s).
- Admin aprova via `reviewExhibitorRequest` → trigger no banco promove role + cria perfil de expositor vazio.
- Polling detecta `approved` → navega para `/dashboard`.
- Header passa a mostrar `/dashboard`, `/table-agenda`, `/profile`. Gate bloqueia `/admin`, `/agenda`, `/explore`, `/exhibitor/*`.

**Pontos frágeis (documentados, não bloqueantes):**

- `exhibitor_profiles` criado vazio pelo trigger; não há onboarding forçado para preencher pitch/portfólio → card pode aparecer vazio no `/explore`.
- `event_tables.exhibitor_profile_id` precisa ser atribuído pelo admin para `/table-agenda` funcionar — sem isso, expositor aprovado não vê mesa.
- Polling de 15s em `/pending-exhibitor` roda mesmo com aba inativa (aceitável).

---

## 2. Checklist de QA

### Admin

| Item | Status | Evidência esperada |
|---|---|---|
| Acesso direto a `/admin` sem login → redireciona `/login` | ✅ passou | gate `_authenticated` |
| Login admin → `/admin` carrega | ✅ passou | header com nav admin |
| `/profile` abre sem voltar para `/login` | ✅ passou | já corrigido em rodada anterior |
| PT / ES alternam idioma | ✅ passou | switch funcional |
| "Apenas minha carteira" / filtro de período | ✅ passou | controles ativos |
| Logout funciona | ✅ passou | volta para `/` |
| Console sem `502` / `Failed to fetch` após logout | ⚠️ revalidar | corrigido por Bloco A+B; validar com nova sessão |

### Visitante

| Item | Status | Evidência esperada |
|---|---|---|
| Login com sucesso | ✅ passou | toast/redirect |
| Pós-login **não** mostra formulário "Entrar" | ✅ corrigido | spinner "Entrando…" e ida direta para `/dashboard` |
| `/dashboard` consistente | ✅ passou | nome do usuário visível |
| `/explore` acessível | ✅ passou | lista carrega |
| `/agenda` acessível | ✅ passou | calendário carrega |
| Logout limpo (console sem 401/502) | ✅ corrigido | sign-out hygiene |

### Expositor

| Item | Status | Causa / próximo passo |
|---|---|---|
| Request pending → `/pending-exhibitor` com polling | ✅ pronto no código | precisa QA com conta real |
| Aprovação admin → role promovida automaticamente | ✅ trigger existe | validar inserção em `user_roles` após aprovar |
| Aprovado vê `/dashboard` + nav de expositor | ✅ gate correto | validar em QA |
| `/table-agenda` mostra mesa | 🔒 bloqueado | depende de `event_tables.exhibitor_profile_id` atribuído |
| `/exhibitor/$id` no `/explore` mostra dados | 🔒 bloqueado | depende de `exhibitor_profiles` preenchido |
| Rejeição mostra nota | ✅ pronto | validar via QA |

---

## 3. Como validar manualmente

**Visitante (crítico):**

1. Sair completamente (limpar sessão ou aba anônima).
2. Acessar `/login`, digitar credenciais válidas de visitante, submeter.
3. Verificar: aparece spinner "Entrando…" → redireciona para `/dashboard`. **Em nenhum momento** o formulário "Entrar" deve aparecer junto do botão "Sair".
4. Navegar `/dashboard → /explore → /agenda → /dashboard`. Sem flicker, sem redirect para `/login`.
5. Logout → console deve ficar limpo de 401/502/Failed to fetch.

**Admin:**

1. Repetir cenários já validados (login, `/admin`, perfil, switches, logout).
2. Após logout, conferir console: não devem aparecer mais `TypeError: Failed to fetch` nem 502 disparados pela invalidação global.

**Expositor (assim que houver conta real):**

1. Visitante solicita acesso de expositor.
2. Admin aprova em `/admin`.
3. Verificar (via SQL ou UI): `user_roles` tem novo registro com `role='exhibitor'`; `exhibitor_profiles` tem linha do `profile_id`.
4. Expositor recarrega `/pending-exhibitor` → polling detecta aprovação → vai para `/dashboard`.
5. Admin atribui mesa em `event_tables` → expositor vê em `/table-agenda`.

---

## 4. Arquivos alterados nesta rodada

- `src/routes/__root.tsx` — filtro de eventos no `onAuthStateChange`; sem invalidação em `SIGNED_OUT`.
- `src/routes/login.tsx` — spinner pós-login, `router.invalidate()` antes do `navigate`, `replace:true`.
- `src/components/site-header.tsx` — sign-out hygiene completo.
- `.lovable/plan.md` — esta documentação.

Nenhuma migração nova. Nenhuma alteração de RLS, booking ou agenda.

---

## 5. Riscos restantes e próximos passos

- **Expositor end-to-end** continua aguardando credenciais reais para QA.
- Se o usuário relatar novos 502, identificar qual `serverFn` específica responde 5xx (log do dev server) e tratar pontualmente — a invalidação global já não é mais a fonte.
- Considerar adicionar onboarding obrigatório do `exhibitor_profiles` (pitch PT/ES) após aprovação para evitar cards vazios no `/explore`.
