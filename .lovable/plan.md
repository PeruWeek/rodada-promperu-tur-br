
## Objetivo

Atualizar o wizard de cadastro do visitante (`/signup`) para cobrir os campos padronizados no documento: empresa expandida (endereço, telefone geral, especialidade, perfil), múltiplos contatos adicionais e manter consentimentos.

## Mudanças no banco

Migração nova adicionando colunas:

- `public.companies`: `address text`, `general_phone text`, `specialty text`, `import_profile text`
- `public.visitor_profiles`: `additional_contacts jsonb not null default '[]'::jsonb`
  (cada item: `{ name, job_title, email, phone_whatsapp, linkedin }`)

A RPC `complete_buyer_signup(p_payload jsonb)` é atualizada para gravar:

- novos campos em `companies`
- `additional_contacts` em `visitor_profiles`

Não há mudança de RLS nem GRANT extra (tabelas já existem).

## Mudanças no schema do formulário (`src/lib/validation/buyer-signup.schema.ts`)

- `stepCompanySchema`: adicionar `address`, `general_phone` (BR phone, opcional), `specialty`, `import_profile`.
- Novo `stepContactsExtraSchema` (Step 4): valida `additional_contacts: z.array({...}).max(5)` com cada item opcional, mas se preenchido exige `name`, `email`, `phone_whatsapp` (BR) válidos.
- `BuyerSignupData`: adicionar os novos campos e `additional_contacts: ContactExtra[]`.

## Wizard (`src/routes/signup.tsx`)

Passa de 5 para 6 passos:

```text
1 Conta  → 2 Empresa  → 3 Contato principal  → 4 Contatos adicionais
5 Perfil → 6 Portfólio e consentimentos
```

- Step 2 ganha campos: Endereço, Telefone geral, Especialidade, Perfil (textarea).
- Novo Step 4 "Contatos adicionais": lista de até 5 blocos com Nome*, Cargo, E-mail*, Telefone/WhatsApp*, LinkedIn. Botão "Adicionar contato" e "Remover" por bloco. Bloco zero permitido (campo é opcional).
- Renumerar Step 4/5 antigos para 5/6 e atualizar `TOTAL_STEPS`, traduções em `pt-BR.json`/`es.json` (`signup.stepTitles.1..6`, novas labels: `address`, `generalPhone`, `specialty`, `importProfile`, `additionalContacts`, `addContact`, `removeContact`, etc.).
- Payload enviado para `complete_buyer_signup` e armazenado em `sessionStorage`/`user_metadata` ganha os novos campos; telefones de contatos adicionais convertidos para E.164 via `toE164BR`.

## Página `/onboarding`

Sem mudanças de UI. A RPC `complete_buyer_signup` aceita os novos campos (todos opcionais exceto os já obrigatórios), então o fluxo continua funcionando para payloads antigos.

## Critérios de aceitação

- Wizard de signup exibe 6 passos com todos os campos novos.
- Salvar cadastro grava endereço, telefone geral, especialidade, perfil em `companies` e `additional_contacts` em `visitor_profiles`.
- Cadastros sem contatos adicionais continuam funcionando (array vazio).
- Validação BR aplicada a telefones dos contatos adicionais.

## Fora do escopo

- Formulário/schema de expositores Peru (cadastro continua via admin/importação).
- Importador de planilha — esta plano só padroniza o formulário; o importador admin pode ser feito depois reaproveitando as mesmas colunas.
