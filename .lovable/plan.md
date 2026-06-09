## Objetivo

Traduzir para português (PT-BR) todo o texto visível ao usuário nos e-mails automáticos de autenticação: **Confirmação de cadastro, Recuperação de senha, Magic link, Convite, Alteração de e-mail e Reautenticação**.

## Onde está hoje

Os textos ficam em componentes React em `src/lib/email-templates/`:

- `signup.tsx` — confirmação de cadastro
- `recovery.tsx` — recuperação de senha ("Password reset")
- `magic-link.tsx` — login por link mágico
- `invite.tsx` — convite
- `email-change.tsx` — alteração de e-mail
- `reauthentication.tsx` — código de reautenticação

Cada arquivo contém: assunto (Preview), título (Heading), corpo (Text), rótulo do botão (Button) e rodapé. Tudo em inglês.

## O que será alterado

Para cada um dos 6 arquivos, traduzir:

| Template | Assunto / Título PT-BR | Botão |
|---|---|---|
| signup | "Confirme seu cadastro na Rodada de Negócios Promperu 2026" | "Confirmar cadastro" |
| recovery | "Redefina sua senha" | "Redefinir senha" |
| magic-link | "Seu link de acesso" | "Entrar agora" |
| invite | "Você foi convidado para a Rodada de Negócios Promperu 2026" | "Aceitar convite" |
| email-change | "Confirme seu novo e-mail" | "Confirmar novo e-mail" |
| reauthentication | "Código de verificação" | (sem botão — exibe código) |

Também traduzo o atributo `lang="en"` para `lang="pt-BR"` no `<Html>` de cada template, e as frases auxiliares ("If you didn't request…", rodapés, etc.).

## Fora do escopo

- Não mudo o visual/estilo dos e-mails.
- Não mexo nos templates transacionais já em PT (`meeting-confirmation`, `meeting-cancelled`).
- Não altero a infraestrutura de envio nem o `auth-email-hook`.
- Não adiciono versão em espanhol (decisão: só PT-BR).

## Validação

Após editar, basta um novo "Esqueci minha senha" para receber o e-mail traduzido. Também é possível pré-visualizar em **Cloud → Emails** no painel.
