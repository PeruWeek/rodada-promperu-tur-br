## Causa raiz confirmada

O fluxo `staffCompleteRegistration` (`src/lib/staff-registration.functions.ts`, linhas 449–456) trata o campo CNPJ como **chave canônica de reatribuição silenciosa**. Quando o perfil já está vinculado a uma empresa (`profile.company_id` presente) e o operador digita um CNPJ que pertence a outra empresa (`findCompanyByNormalizedTaxId`), o código faz:

```ts
if (canonicalCompany) {
  await fillMissingCompanyFields(canonicalCompany, companyPatch);
  companyId = canonicalCompany.id;   // ← relink implícito
}
```

E logo depois (linhas 519–537) grava `profiles.company_id = canonicalCompany.id` e emite `profile.company_linked`.

### Evidência no banco (Naline Correia · `e0438f6c-f8dd-4196-9c0f-4912f177611c`)

- Estado atual: vinculada a `2429b47f` (`COPASTUR`), deveria estar em `694245f4` (`AQUARELA VIAGEM`).
- `audit_logs` mostra o novo relink em **2026-07-02 13:32:45** (`profile.company_linked`, sem `company_contact_reassigned` correspondente), logo após a reconciliação manual de 13:27 — assinatura idêntica à regressão de 07-01 18:54: veio do fluxo `Completar cadastro` ao digitar o CNPJ da COPASTUR.

### Por que deixar em branco não reverte

O ramo `else` da linha 458 só executa quando **não há** empresa canônica com aquele CNPJ. Com `tax_id` vazio, `normalizedTaxId = ""`, `findCompanyByNormalizedTaxId` retorna `null`, e o código apenas faz `UPDATE companies SET tax_id = null` na empresa **já relinkada** (`2429b47f`). Nunca há caminho de rollback para a empresa anterior — `profile.company_id` permanece na COPASTUR.

---

## Correção proposta

### 1. Eliminar relink implícito por CNPJ (arquivo `src/lib/staff-registration.functions.ts`)

Na ramificação `if (companyId)` (perfil já vinculado):

- **Remover** o `companyId = canonicalCompany.id` silencioso.
- Se `normalizedTaxId` bater com uma empresa canônica **diferente** da atual, **rejeitar** a submissão com erro claro:

  > “O CNPJ informado pertence a outra empresa cadastrada (`<trade_name>`). Reatribuição de contato entre empresas precisa ser feita pelo fluxo ‘Reatribuir contato’ (Admin › Empresas). O cadastro não foi alterado.”

- Não gravar `tax_id` na empresa atual nesse caso (evita poluir a empresa correta com o CNPJ do grupo).
- Continuar permitindo `UPDATE companies` normalmente quando o CNPJ digitado é o **da própria empresa** ou está vazio.
- O tratamento de `duplicate key` (linhas 463–471) passa a devolver o mesmo erro de conflito (nunca relinka).

Reuso silencioso por CNPJ permanece **apenas** no ramo de stub (`else` da linha 478 — `profile.company_id IS NULL`), que é o caso legítimo de importação/completação inicial.

### 2. Reconciliar o caso Naline (dados, via `supabase--insert`)

- `UPDATE profiles SET company_id = '694245f4-9ef4-464d-a595-1310694a9e6e' WHERE id = 'e0438f6c-f8dd-4196-9c0f-4912f177611c'`
- `INSERT INTO audit_logs (action = 'company_contact_reassigned', payload = { reason: 'Reconciliação pós-fix: staffCompleteRegistration não pode relinkar por CNPJ. Naline pertence à AQUARELA VIAGEM.', source: 'manual_reconciliation', ... })`
- Triggers existentes recalculam `companies.is_active` e limpam `company_event_pipeline`.

### 3. Não mexer em outros fluxos

- `reassignCompanyContact` (`src/lib/company-contacts.functions.ts`) continua sendo o único caminho autorizado para trocar `profiles.company_id` de contato já vinculado — já exige `reason` e grava `company_contact_reassigned`.
- Nenhuma mudança de UI: o `CompleteRegistrationDialog` já mostra o erro devolvido pelo backend via `toast.error`.

---

## Critérios de aceite

- Editar Naline (ou qualquer contato AQUARELA) e digitar CNPJ da COPASTUR: bloqueia com mensagem explicando o fluxo de reatribuição, `profiles.company_id` fica intacto, `companies.tax_id` da AQUARELA não é sobrescrito.
- Deixar CNPJ em branco em edição posterior: também não altera vínculo (era o comportamento seguro; agora sem regressão).
- Reatribuição real de empresa continua funcionando via `Admin › Empresas › Reatribuir contato`.
- Stubs importados sem `company_id` continuam sendo reaproveitados por CNPJ (comportamento original preservado).
- Estado atual da Naline: vinculada a `694245f4` (AQUARELA VIAGEM); Emerson e Midori inalterados; Wellika permanece em `2429b47f`.

---

## Entrega ao final da build

1. arquivos alterados (`src/lib/staff-registration.functions.ts`) e migração de dados (Naline)
2. causa raiz confirmada
3. confirmação do relink de `profiles.company_id` e evidência de audit
4. resumo da correção
5. como o novo relink AQUARELA→COPASTUR foi evitado (erro explícito no backend, sem overwrite silencioso)