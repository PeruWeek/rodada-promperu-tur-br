Objetivo: atualizar apenas o conteúdo textual do template de e-mail de boas-vindas do buyer, sem alterar fluxo de disparo, idempotência ou regras de envio.

Verificação realizada:
- Analisados `src/routes/_authenticated/agenda.tsx`, `src/lib/pdf.ts`, `src/lib/exports/csv.ts` e `src/lib/exports/xlsx.ts`.
- Na agenda do usuário final existe apenas o botão de download PDF. Não há opções CSV ou XLSX expostas na UI.

Alteração:
1. Editar `src/lib/email-templates/buyer-welcome.tsx`:
   - Trocar todas as ocorrências do nome do evento para `PERU MICE Networking evento` (inclusive no assunto).
   - Incluir orientação de recuperação de senha.
   - Substituir a frase genérica sobre formatos de download por `baixar sua agenda em PDF` (único formato disponível na plataforma para o usuário final).
   - Ajustar o restante do corpo conforme o texto fornecido.

Nenhum outro arquivo será alterado.
