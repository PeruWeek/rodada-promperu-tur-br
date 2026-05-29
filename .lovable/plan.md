## Objetivo

Atualizar os 6 templates de e-mail de autenticação para:
1. Conteúdo bilíngue (Português + Espanhol empilhados no mesmo e-mail).
2. Remetente fixo `Rodada Peru 2026 <rodada@promperu.tur.br>`.
3. Assuntos bilíngues também (ex.: `Confirme seu e-mail · Confirma tu correo`).

## Mudanças

### 1. `src/routes/lovable/email/auth/webhook.ts`
- Trocar `FROM_DOMAIN` / `from` para `Rodada Peru 2026 <rodada@promperu.tur.br>`.
- Atualizar `EMAIL_SUBJECTS` para versões bilíngues PT · ES:
  - signup: `Confirme seu e-mail · Confirma tu correo`
  - invite: `Você foi convidado · Has sido invitado`
  - magiclink: `Seu link de acesso · Tu enlace de acceso`
  - recovery: `Redefinir senha · Restablecer contraseña`
  - email_change: `Confirme seu novo e-mail · Confirma tu nuevo correo`
  - reauthentication: `Seu código de verificação · Tu código de verificación`

### 2. Os 6 templates em `src/lib/email-templates/`
- `signup.tsx`, `invite.tsx`, `magic-link.tsx`, `recovery.tsx`, `email-change.tsx`, `reauthentication.tsx`.
- Reescrever cada um para mostrar bloco PT seguido de um separador (`<Hr />`) e bloco ES.
- Cada bloco tem: Heading, parágrafo(s) explicativos, e o mesmo CTA (mesmo `confirmationUrl`) com label no idioma — exceto reauthentication que mostra o token nos dois idiomas.
- Manter a identidade visual já presente em `_shared.tsx` (cor primária `#D52B1E`, fonte, container).
- Rodapé bilíngue: "Se você não solicitou… / Si no solicitaste…".

### 3. `src/routes/lovable/email/auth/preview.ts`
- Sem mudanças funcionais — os mesmos props (`siteName`, `siteUrl`, `recipient`, `confirmationUrl`, `token`, `oldEmail`/`newEmail`) continuam servindo.

## Observação sobre idioma do perfil

Optamos por bilíngue empilhado em todos os e-mails de auth (decisão do usuário), então não é necessário consultar `profiles.preferred_language` no webhook. Isso mantém o handler simples e funciona inclusive no signup, quando o perfil ainda não existe.

## Verificação

Após a implementação:
- Pré-visualizar cada template (botão "Visualizar e-mail" em Cloud → Emails) para conferir o layout PT/ES.
- Confirmar no log de envio que o `from` aparece como `rodada@promperu.tur.br`.
