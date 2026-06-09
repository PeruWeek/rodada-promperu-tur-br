# Editor de Templates de E-mail no Admin

## Objetivo
Permitir que o admin edite **assunto**, **nome do remetente** e **textos do corpo** (saudação, parágrafos de intro/outro, rótulo do botão, assinatura) de cada template — sem alterar layout, cores ou estrutura visual. Cobertura: e-mails de reunião (`meeting-confirmation`, `meeting-cancelled`) e os 6 templates de autenticação (`signup`, `magic-link`, `recovery`, `invite`, `email-change`, `reauthentication`).

## O que muda para o usuário
- Nova aba **"E-mails"** no `/admin`, ao lado de Auditoria.
- Lista de templates cadastrados, cada um com:
  - Nome do remetente exibido (ex.: "Rodada de Negócios PromPerú")
  - Assunto em **PT-BR** e **ES**
  - Blocos de texto editáveis por idioma: saudação, parágrafo de abertura, parágrafo de fechamento, rótulo do botão (CTA), assinatura
- Botão "Restaurar padrão" por campo (volta ao texto original do código).
- Botão "Enviar teste" reutilizando o fluxo atual da aba Auditoria.

Variáveis dinâmicas continuam disponíveis nos textos via placeholders simples: `{{visitorName}}`, `{{exhibitorCompany}}`, `{{tableNumber}}`, `{{slotStart}}`, `{{slotEnd}}`. O sistema substitui antes do envio.

## Limites (intencionais)
- **Não** edita HTML/CSS, cores, fontes, logo ou estrutura — preserva o branding.
- **Não** cria templates novos pela UI (continua sendo via código).
- **Remetente**: só o "nome amigável". O e-mail/domínio do remetente é definido pela infraestrutura (SendGrid/domínio verificado) e não muda por template para não quebrar deliverability.

## Como funciona por trás
1. **Tabela `email_template_overrides`** (`public`, RLS: só admin/staff leem e escrevem; `service_role` lê para os envios):
   - `template_name` (PK)
   - `from_name` (text, nullable)
   - `subject_pt`, `subject_es` (text, nullable)
   - `greeting_pt`, `greeting_es`
   - `intro_pt`, `intro_es`
   - `outro_pt`, `outro_es`
   - `cta_label_pt`, `cta_label_es`
   - `signature_pt`, `signature_es`
   - `updated_by` (uuid → profiles), `updated_at`
   - Qualquer coluna `NULL` = usa o padrão do código.
2. **Refator dos templates** em `src/lib/email-templates/*.tsx`: extrair os textos atuais para constantes default e aceitar os mesmos campos via props (com fallback). Layout/estilos ficam idênticos.
3. **Helper `resolveTemplateContent(templateName, language, templateData)`**: lê override do banco (com cache de 60s em memória), interpola placeholders e devolve `{ subject, fromName, content }`.
4. **`/lovable/email/transactional/send`** passa a chamar o helper para montar assunto/from/props antes do `render()`.
5. **Server functions admin** em `src/lib/email-templates.functions.ts`:
   - `listEmailTemplates()` — devolve templates registrados + overrides atuais + previewData.
   - `updateEmailTemplate({ templateName, fields })` — valida com Zod (limites de tamanho, sanitização), grava no banco, registra em `audit_logs` (`email_template.updated`).
   - `resetEmailTemplateField({ templateName, field })` — seta `NULL`.
6. **UI** `src/components/admin/email-templates-tab.tsx`:
   - Lista com accordion por template
   - Tabs PT / ES
   - Inputs (assunto, from) + Textareas (blocos)
   - Painel lateral com placeholders disponíveis e botão "Copiar"
   - Indicador "Personalizado" / "Padrão" por campo
7. **Aba no `/admin`**: registrar em `pipeline-tabs.tsx` (ou no componente que monta as abas) — "E-mails".

## Detalhes técnicos
- Migration cria a tabela com `GRANT` para `authenticated` e `service_role`, RLS restringindo leitura/escrita a `has_role(auth.uid(),'admin'|'staff')` e leitura para `service_role`.
- Auditoria: nova ação `email_template.updated` adicionada ao `ACTION_LABELS` da aba Auditoria.
- i18n por template fica desacoplado do `i18n/index.ts` (esses textos são de e-mail, não da UI).
- Cache simples in-memory por instância (TTL 60s) para evitar query em cada envio; invalidado ao salvar.
- Placeholder engine: replace seguro, escapando HTML (`React` já escapa, mas o helper roda antes de virar JSX, então sanitizar `<`/`>` antes de injetar).

## Itens fora do escopo
- Editor WYSIWYG do corpo HTML.
- Versionamento/histórico de mudanças (fica registrado só em `audit_logs`).
- Editar `to:` fixo (templates de auth continuam indo para o destinatário do evento).
- Trocar domínio do remetente pela UI.

## Validação ao terminar
- Editar assunto e textos do `meeting-confirmation` em PT, enviar teste pela aba Auditoria e confirmar que chega com o texto novo e assunto novo.
- Restaurar campo e reenviar — chega o padrão.
- `audit_logs` mostra a edição.
