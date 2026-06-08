Quando um usuário já autenticado acessa `/login` (ou `/signup`), redirecionar automaticamente para o painel (`/dashboard`), evitando que a tela de login apareça para quem já está logado.

Arquivos:
- `src/routes/login.tsx` — adicionar `beforeLoad` que chama `supabase.auth.getUser()`; se houver usuário, `throw redirect({ to: "/dashboard" })`.
- `src/routes/signup.tsx` — mesmo comportamento.

O guard fica client-side (igual ao já usado em `_authenticated.tsx`), evitando flash da tela de login em refresh quando a sessão está no `localStorage`.