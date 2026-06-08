## Remover o campo "ID de cadastro" do cadastro de visitantes

Verifiquei: o campo ainda existe no formulário, na validação e no RPC. A remoção anterior só havia sido planejada, não aplicada.

### Mudanças

1. **`src/routes/signup.tsx`**
   - Remover o input `registration_id` (label, helper, FieldError).
   - Remover `registration_id: ""` do estado inicial.
   - Remover `registration_id` do payload enviado ao RPC.

2. **`src/lib/validation/buyer-signup.schema.ts`**
   - Remover `registration_id` de `stepCompanySchema` e do tipo `BuyerSignupData`.

3. **`src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json`**
   - Remover as chaves `registrationId` e `registrationIdHelp`.

4. **Migration (RPC `complete_buyer_signup`)**
   - Remover a checagem `if coalesce(btrim(p_payload->>'registration_id'), '') = ''` para que o RPC não exija mais o campo.
   - Manter a coluna `registration_id` na tabela `companies` (preserva dados existentes); o INSERT/UPDATE pode continuar gravando `null` quando não vier no payload.

### Fora de escopo
- Não remover a coluna `registration_id` da tabela `companies`.
- Sem alterações no formulário de expositores Peru.
