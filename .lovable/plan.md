## Objetivo

Você não recebeu o email de confirmação. Vou desbloquear seu acesso manualmente sem depender do envio de email.

## Passos

1. **Confirmar o email manualmente no Supabase Auth**
   - Rodar UPDATE em `auth.users` setando `email_confirmed_at = now()` para `rodada@promperu.tur.br`.
   - Resultado: você consegue fazer login imediatamente com a senha que cadastrou.

2. **Promover o usuário a admin**
   - Inserir `('<seu auth_user_id>', 'admin')` em `public.user_roles` (já existe registro `visitor` criado pelo trigger `handle_new_user`).
   - Resultado: ao entrar, você verá a aba **Admin** no menu e poderá testar todas as áreas restritas.

3. **(Opcional, recomendado para testes) Desativar a exigência de confirmação de email**
   - Posso desligar "Confirm email" nas configurações de Auth do Supabase para que novos cadastros entrem direto, útil enquanto o envio de email customizado não está configurado.
   - Se preferir manter a confirmação obrigatória (mais seguro), pulamos esta etapa.

## Sobre o email não ter chegado

O projeto está usando o remetente padrão do Supabase (`noreply@mail.app.supabase.io`), que costuma ser bloqueado/atrasado por servidores corporativos como `promperu.tur.br`. A solução definitiva é configurar um domínio próprio de envio (ex.: `notify.promperu.tur.br`) — posso fazer isso em seguida se quiser, mas não é necessário para você logar agora.

## Detalhes técnicos

```sql
-- 1. Confirmar email
UPDATE auth.users
SET email_confirmed_at = now(), confirmed_at = now()
WHERE email = 'rodada@promperu.tur.br';

-- 2. Promover a admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users
WHERE email = 'rodada@promperu.tur.br'
ON CONFLICT (user_id, role) DO NOTHING;
```

Confirma para eu executar? Me diga também se quer que eu já desative a confirmação de email obrigatória (passo 3).