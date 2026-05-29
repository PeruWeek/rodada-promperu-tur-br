# Próximos passos

## 1. Configurar URLs no Supabase (ação manual sua)

No painel do Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://rodada.promperu.tur.br`
- **Redirect URLs** (lista de permissões), adicionar:
  - `https://rodada.promperu.tur.br/**`
  - `https://rodada-promperu-tur-br.lovable.app/**`
  - `https://id-preview--9163060e-b183-4ce2-8782-e5a412537db3.lovable.app/**`
  - `http://localhost:3000/**`

Sem isso, o link do e-mail continua apontando para `localhost:3000` mesmo quando o usuário abre em produção.

## 2. Testar o fluxo ponta-a-ponta

a) Signup novo → ver painel "Verifique seu e-mail" (sem redirecionar para /onboarding).
b) Abrir link válido → cair em `/onboarding` autenticado.
c) Abrir link duas vezes (ou esperar 1h) → deve cair em `/login?reason=otp_expired`, ver o `Alert` e poder reenviar confirmação.
d) Reenviar confirmação → toast de sucesso, novo e-mail chega.

## 3. (Opcional) Customizar template de e-mail do Supabase

Hoje o e-mail usa o template padrão do Supabase. Podemos:
- Personalizar o template no painel Supabase (Auth → Email Templates), ou
- Scaffoldar templates customizados via Lovable Emails (requer domínio de e-mail próprio configurado).

## 4. (Opcional) Polimento

- Cooldown de 60s no botão "Reenviar confirmação" para evitar spam/rate-limit do Supabase.
- Mensagem específica quando o erro do hash for diferente de `otp_expired` (ex.: `access_denied` por outro motivo).

---

Me diga quais desses passos quer que eu execute agora (provavelmente 3 e/ou 4, já que 1 e 2 dependem de você).
