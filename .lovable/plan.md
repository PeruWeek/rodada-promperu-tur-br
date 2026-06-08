## Problema

A tela "Conte-nos quem você é" (`/onboarding`) está aparecendo para usuários que **já foram cadastrados** — seja pelo admin (que já define a categoria) ou pelo formulário público de comprador (que já cria como `visitor`).

Hoje o guard em `src/routes/_authenticated.tsx` força onboarding sempre que `!profile.company_id && !req`. Isso ignora o fato de o usuário já ter um **papel atribuído** (`visitor` ou `exhibitor`), o que é o sinal real de que ele já foi cadastrado.

## Correção

### 1. `src/routes/_authenticated.tsx` — guard de onboarding

Trocar a regra para usar o **primary role** como fonte da verdade:

- Se `primaryRole === "admin" | "staff"` → vai para `/admin` (já existe).
- Se `primaryRole === "visitor"` → entra direto no app (`/dashboard` ou `/agenda`). **Nunca** redirecionar para `/onboarding`.
- Se `primaryRole === "exhibitor"`:
  - Se tem `event_tables` atribuída ou request aprovado → entra no app (`/dashboard`).
  - Se tem request `pending`/`rejected` → `/pending-exhibitor`.
  - Não mandar para `/onboarding` (ele já é expositor).
- Apenas quando `primaryRole === null` (usuário autenticado, mas sem nenhum papel — caso raro, geralmente OAuth novo) → manter o fluxo atual de `/onboarding`.

### 2. `src/routes/onboarding.tsx` — proteção da própria página

Adicionar um `useEffect` que, ao carregar o profile, se o usuário **já tem** um papel `visitor` ou `exhibitor`, redireciona imediatamente:

- `visitor` → `/agenda`
- `exhibitor` com request pendente → `/pending-exhibitor`
- `exhibitor` aprovado → `/dashboard`
- `admin`/`staff` → `/admin`

Isso evita que alguém acesse `/onboarding` digitando a URL manualmente e veja o seletor por engano.

### 3. Sanity check no backend

Confirmar via `supabase--read_query` que os usuários cadastrados pelo admin/formulário realmente recebem o role correto em `user_roles` na hora da criação. Se algum fluxo de criação não estiver inserindo o role, corrigir o ponto de criação (server function de admin ou RPC `complete_buyer_signup`).

## Critérios de aceite

- Visitante cadastrado pelo formulário público faz login → cai direto em `/agenda` (ou `/dashboard`), sem ver o seletor.
- Expositor cadastrado pelo admin faz login → cai em `/dashboard` ou `/pending-exhibitor` conforme status, sem ver o seletor.
- Admin/staff continua indo para `/admin`.
- Só vê `/onboarding` quem realmente não tem papel nenhum atribuído.
