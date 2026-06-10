## Objetivo

No formulário público `/signup`, quando o usuário digita um e-mail que já existe como pré-cadastro pendente (importado pelo admin), oferecer autopreenchimento dos Steps 2 e 3 com consentimento explícito. Campos permanecem editáveis. Sem mudanças em trigger, schema, RLS ou no fluxo `handle_new_user` (que já reaproveita o `profile` existente quando `pending_signup=true` e `auth_user_id IS NULL`).

## 1. `lookupPreRegistration` em `src/lib/pre-registration.functions.ts`

Server function pública (sem `requireSupabaseAuth`).

- **Input** (Zod): `{ email: string }` — `.trim().toLowerCase().email().max(255)`. Falha de validação → `{ found: false }` (não vaza detalhe).
- **Query** via `supabaseAdmin` (import dentro do handler):
  - `profiles` por `email` (match exato após normalização — sem `ilike`), filtrando `pending_signup=true AND auth_user_id IS NULL`.
  - Join leve em `companies` pelo `company_id`.
- **Mitigação de enumeração**:
  - Delay constante (~250ms) em **todos** os caminhos (sucesso, não encontrado, erro, validação inválida).
  - Mesma resposta `{ found: false }` para: e-mail malformado, sem registro, registro já reivindicado (`auth_user_id` preenchido), erro interno.
- **Payload** (`{ found: true; data }`) — apenas campos do formulário, nada de IDs, e-mails secundários ou contatos adicionais:
  - de `companies`: `trade_name`, `legal_name`, `tax_id`, `city`, `state_code`, `website`, `instagram`, `linkedin`, `address`, `general_phone`, `specialty`, `import_profile`.
  - de `profiles`: `full_name`, `job_title`, `phone` (reformatado com `formatBRPhone`), `whatsapp` (idem), `preferred_language`.
- Telefones armazenados em E.164/dígitos são convertidos via `formatBRPhone` para casar com a máscara do formulário.

## 2. Ajustes em `src/routes/signup.tsx`

Novo estado `prefill`:

```ts
type Prefill =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "found"; data: Partial<BuyerSignupData> }
  | { status: "consumed"; email: string };
```

- No **Step 1** (campo email), `onBlur` dispara `useServerFn(lookupPreRegistration)` quando o e-mail é válido e diferente do último consultado. Pequena guarda anti-duplicação (in-flight token).
- Quando `status === "found"`, renderiza **banner azul** acima dos campos do Step 1 (e visível no topo do Step 2 também):
  - Texto: "Encontramos um pré-cadastro com este e-mail. Quer preencher automaticamente?"
  - Botão primário: "Usar meus dados" → mescla `prefill.data` no `data` (somente campos vazios; nunca sobrescreve o que o usuário já digitou), seta `status: "consumed"`, mostra toast de sucesso.
  - Botão secundário: "Começar em branco" → seta `status: "consumed"` (sem mesclar) e esconde o banner.
- Se o usuário alterar o e-mail depois de consumir, reseta para `idle` e refaz lookup no próximo blur.
- `onFinish` permanece como está — `supabase.auth.signUp` + trigger `handle_new_user` cuidam da reivindicação do `profile` existente.

## 3. i18n (`pt-BR.json` e `es.json`)

Novas chaves dentro de `signup`:

```json
"prefill": {
  "bannerTitle": "Pré-cadastro encontrado",
  "bannerBody": "Encontramos seus dados na base do evento. Quer preencher o formulário automaticamente? Você poderá editar tudo.",
  "useMyData": "Usar meus dados",
  "startBlank": "Começar em branco",
  "toastFilled": "Campos preenchidos. Revise e ajuste se precisar."
}
```

## Fora de escopo

Trigger, schema, RLS, `complete_buyer_signup`, abas admin, fluxo de e-mail "já cadastrado" (deixado com a mensagem nativa do Supabase Auth).

## Critérios de aceite (QA pós-deploy, aba anônima)

1. Digitar e-mail de um pré-cadastro pendente e sair do campo → banner aparece.
2. Clicar "Usar meus dados" → campos vazios dos Steps 2 e 3 são preenchidos; campos já digitados não são sobrescritos.
3. Editar manualmente qualquer campo preenchido funciona.
4. E-mail sem pré-cadastro → nenhum banner, nenhuma diferença visível.
5. E-mail de usuário já cadastrado (com `auth_user_id`) → nenhum banner (mesma resposta de "não encontrado").
6. Após concluir o signup com pré-cadastro, no admin: o registro existente é reivindicado, sem duplicar `companies` ou `profiles`.
7. Caixa de QA real: placeholder `<email-qa-confirmar>` será substituído no momento da validação final.
