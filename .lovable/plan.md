## Diagnóstico

O e-mail que você recebeu ("Confirm your signup") veio de `no-reply@auth.lovable.cloud` em inglês — é o template padrão da Lovable, e não o template bilíngue (PT/ES) que já existe no projeto em `src/routes/lovable/email/auth/webhook.ts` + `src/lib/email-templates/signup.tsx`.

Isso indica que o webhook de e-mails de autenticação ainda não está ativado/conectado ao backend de auth, mesmo o domínio `rsvp.promperu.tur.br` estando verificado.

O remetente correto, conforme já configurado no projeto, é:
- **From:** `Rodada de Negócios Promperu 2026 <rodada@promperu.tur.br>`
- **Domínio de envio (DKIM/SPF):** `rsvp.promperu.tur.br` (verificado)
- **Assunto:** `Confirme seu e-mail · Confirma tu correo`
- **Conteúdo:** bilíngue PT/ES com botão "Confirmar e-mail / Confirmar correo" e link de login.

## O que vou fazer

1. Re-executar o scaffold dos templates de e-mail de autenticação com sobrescrita confirmada, para garantir que o webhook fique registrado e ativado no hook do Supabase Auth (sem alterar o conteúdo dos templates bilíngues já personalizados — caso o scaffold tente sobrescrevê-los, mantemos a versão atual do `signup.tsx` e demais templates customizados).
2. Confirmar que o roteamento `/lovable/email/auth/webhook` está publicado e que o Supabase Auth está apontando para ele.
3. Pedir que você publique novamente o app, se necessário, para que o webhook entre em vigor em produção.

## Como validar depois

- Fazer um novo cadastro com um e-mail de teste.
- O e-mail deve chegar:
  - De `rodada@promperu.tur.br` (exibido como "Rodada de Negócios Promperu 2026").
  - Com assunto bilíngue PT/ES.
  - Com o conteúdo "Cadastro recebido com sucesso! / ¡Registro recibido con éxito!".
- Caso ainda chegue o template padrão da Lovable, monitorar em **Cloud → Emails** o status do hook e da fila.

## Observação

O template em PT/ES e o remetente já estão corretos no código — não precisa alterar o conteúdo. O ajuste é apenas de ativação do hook personalizado.
