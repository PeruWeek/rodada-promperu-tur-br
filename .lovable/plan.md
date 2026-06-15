## Remover campo Telefone do contato (manter só WhatsApp)

Alinhar a edição admin com a regra já aplicada em signup e /profile: contato pessoal usa apenas WhatsApp.

### Mudanças

**`src/components/admin/companies/edit-company-drawer.tsx`**
- Remover o `<Field label={t("signup.phone")}>` com `profile.phone` (linhas 313-315) na aba "Contato".
- Manter o campo `general_phone` da empresa (linha 288-290), pois é telefone institucional, não pessoal.
- Remover `phone` do estado `profile` (tipos nas linhas 55-56 e inicialização na linha 138) — não enviar mais ao update.

**`src/routes/_authenticated/profile.tsx`** (verificar)
- Confirmar se já não há input de `phone` pessoal; se houver, remover também para consistência.

**Nota sobre dados**
- Não vamos rodar migration para dropar a coluna `phone` em `profiles` agora — apenas paramos de ler/escrever na UI. Valores antigos permanecem no banco até decisão posterior de cleanup.

### Fora de escopo
- Tradução/labels: nenhum texto novo é necessário (apenas remoção).
- Schema do banco: sem alteração.