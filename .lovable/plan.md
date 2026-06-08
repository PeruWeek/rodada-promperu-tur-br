## Atualização do formulário de visitante

Faz sentido — vou aplicar as exigências, com os seguintes pontos:

- "Razão social / CNPJ" será tratado como **dois campos obrigatórios** (sua resposta na pergunta). O label do bloco/seção fica `Razão social / CNPJ` e cada input mantém helper text próprio.
- `empresa.id_cadastro` será um campo de texto livre, obrigatório, salvo em `companies.registration_id` (sem unicidade, sem validação contra lista — conforme escolha).
- `empresa.pais` continua fixo = `BR` (já é hoje no RPC).
- Os demais "obrigatórios do cadastro rápido" listados já são obrigatórios nas etapas atuais (nome fantasia, cidade, UF, contato principal completo, idioma, tipo de buyer, segmentos, consentimento).

### 1. Banco

Migration:

- `ALTER TABLE public.companies ADD COLUMN registration_id text` (nullable no schema, mas obrigatório no RPC).
- Atualizar `public.complete_buyer_signup`:
  - Exigir `tax_id`, `legal_name` e `registration_id` (raise exception se vazios).
  - Persistir `registration_id` no INSERT e no UPDATE de `companies`.

### 2. Validação (`buyer-signup.schema.ts`)

`stepCompanySchema`:

- `tax_id`: agora obrigatório (`min(1)` + `isValidCNPJ` — mensagem `cnpjInvalid`).
- `legal_name`: agora obrigatório (`trim().min(2).max(160)`).
- Novo `registration_id: z.string().trim().min(1).max(120)` (obrigatório).

`BuyerSignupData`: adicionar `registration_id: string`. `emptyData` recebe `registration_id: ""`.

### 3. Wizard (`src/routes/signup.tsx`) — Passo 2 "Empresa"

- Reorganizar a seção em um bloco com cabeçalho "Razão social / CNPJ":
  - Input **Razão social** (obrigatório) + helper `Informe a razão social da empresa`.
  - Input **CNPJ** (obrigatório, máscara já existente) + helper já existente.
- Adicionar input **ID de cadastro** (obrigatório) com helper `Informe o ID de cadastro fornecido pela organização`. Posição: logo após o bloco Razão social/CNPJ, antes de "Nome fantasia".
- Marcar os campos com asterisco `*` (mesma convenção dos outros required).
- Incluir `registration_id` no payload enviado ao RPC `complete_buyer_signup`.

### 4. i18n (`pt-BR.json` e `es.json`)

Adicionar em `signup`:

- `companyIdentificationGroup`: `Razão social / CNPJ` (label da seção)
- `legalName` (atualizar): manter como `Razão social`
- `legalNameHelp`: `Informe a razão social da empresa`
- `taxIdHelp`: `Informe o CNPJ da empresa`
- `registrationId`: `ID de cadastro`
- `registrationIdHelp`: `Informe o ID de cadastro fornecido pela organização`

Espelhar em espanhol (`Razón social`, `Identificador de registro`, etc.).

### 5. Fora de escopo

- Importador admin / planilhas: a coluna `registration_id` fica disponível para o importador no futuro, mas nenhuma tela admin será alterada agora.
- Formulário de expositores Peru: inalterado (conforme decisão anterior).
- Perfis existentes sem `registration_id`: não serão preenchidos retroativamente.

### Observação importante

Tornar `tax_id` (CNPJ) e `legal_name` obrigatórios é uma exigência mais restritiva que a anterior. Quem já se cadastrou sem preencher esses campos continua válido no banco (não há backfill); apenas novos cadastros passam a exigi-los.
