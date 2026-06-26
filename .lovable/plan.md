**Diagnóstico objetivo já confirmado**

1. **Versão em execução**
   - Código local/alterado: branch `edit/edt-6b115574-80f9-4336-ade0-38910ad00165`, commit `16cba621e9c2b86093406e143ef1c6c96233b9f4`.
   - Site publicado `https://rodada.promperu.tur.br`: bundle atual não contém assinaturas críticas da correção (`getCompanyAgenda`, `profile_meetings_count`).
   - Conclusão: **o ambiente publicado não está com a versão corrigida**. Ainda assim, há ajustes adicionais necessários no código atual antes de publicar, porque encontrei divergências reais remanescentes.

2. **Causa raiz real da busca por `copastur`**
   - Fluxo real da aba `Empresas`: `src/components/admin/companies/companies-tab.tsx` → `listAdminCompanies` em `src/lib/admin.functions.ts`.
   - O banco possui 3 empresas que batem em campos próprios da empresa:
     - `COPASTUR TURISMO` — ativa, `trade_name` contém Copastur.
     - `AQUARELA AGENCIA` — inativa, `legal_name = COPASTUR`.
     - `COPASTUR` — inativa, stub.
   - Quando o filtro de status está em `Todos`, as 3 aparecem legitimamente pela regra atual. O problema operacional é que a busca principal ainda permite que empresas inativas/stubs entrem quando o usuário quer a busca administrativa padrão.
   - Além disso, há outro fluxo de busca de empresa (`searchCompaniesForLink`) com regra própria e menos completa, então a regra precisa ser unificada.

3. **Causa raiz real da perda da segunda pessoa no PDF/listagem cliente**
   - Fluxo real da aba `Agendamentos`: `src/components/admin/registrants-tab.tsx` → `listEventRegistrants` / `_listEventRegistrantsImpl` → botão PDF cliente usa `getCompanyAgenda`.
   - COPASTUR TURISMO tem 3 profiles no `company_id`, mas só 2 são participantes válidos:
     - Naline Correia — ativa, role `visitor`, 9 reuniões.
     - wellika Medeiros da silva — ativa, role `visitor`, 10 reuniões.
     - Daniele/Naline stub — sem `auth_user_id`, sem role, 0 reuniões; deve ficar fora.
   - No pipeline, `primary_profile_id` da COPASTUR aponta para o stub sem login (`39b2871c...`). O código atual ainda tem um filtro em `_listEventRegistrantsImpl` que exige `primary_profile_id`, e o PDF publicado ainda está usando bundle antigo. A regra correta deve depender de `company_id` e expandir todos os participantes elegíveis, nunca limitar pelo responsável principal.

**Plano de correção**

1. **Unificar a regra de busca de empresas**
   - Em `src/lib/admin.functions.ts`, criar helpers únicos para normalização/ranking:
     - `trim`
     - `lowercase`
     - remoção de acentos
     - campos permitidos: `trade_name`, `legal_name`, `tax_id`
     - ranking: exato → prefixo → parcial
   - Aplicar esses helpers em:
     - `listAdminCompanies`
     - `searchCompaniesForLink`
   - Remover qualquer dependência de `profiles.email`, `profiles.full_name`, nome/e-mail de contato ou campos indiretos nos fluxos de busca de empresa.
   - Ajustar a busca para não depender de `ilike` como fonte da verdade, porque `ilike` não remove acentos; usar pós-filtro normalizado como regra final.
   - Manter o filtro de status explícito: por padrão, a tela deve buscar ativos; se o usuário escolher `Todos`, empresas inativas continuam aparecendo porque isso é uma escolha explícita do filtro.

2. **Corrigir definitivamente a fonte da listagem/PDF cliente**
   - Em `src/lib/staff-exports.functions.ts`, extrair uma função compartilhada para expandir pipeline por empresa em `1 linha por pessoa`:
     - entrada: linhas do pipeline do evento
     - busca todos os profiles por `company_id`
     - inclui apenas profiles ativos, com `auth_user_id`, e role real `visitor` ou `exhibitor`
     - exclui `admin`, `staff`, `cliente`
     - deduplica apenas por `profile_id`
     - ordena o `primary_profile_id` primeiro quando ele for elegível, mas nunca exclui os demais
   - Usar essa mesma função em:
     - `_listEventRegistrantsImpl`
     - `listClienteOverviewBase`
   - Remover a exigência problemática `primary_profile_id` como condição para uma empresa entrar na expansão.

3. **Padronizar PDF consolidado da empresa**
   - Em `getCompanyAgenda`, filtrar os contatos da empresa com a mesma regra de elegibilidade da listagem:
     - ativos
     - participantes reais (`visitor`/`exhibitor`)
     - não internos (`admin`/`staff`/`cliente`)
   - Garantir `contactCount` = número de contatos elegíveis, não todos os profiles da empresa.
   - Garantir que o PDF de empresa consolida as agendas desses contatos elegíveis e deduplica reuniões por `meeting.id`.

4. **Validar com dados reais**
   - Reexecutar consultas reais no banco para confirmar:
     - busca `copastur` com status ativo retorna só `COPASTUR TURISMO`.
     - os dois falsos positivos são inativos/stubs e só aparecem se status `Todos` for escolhido.
     - COPASTUR TURISMO possui exatamente 2 participantes válidos.
     - dataset final da listagem e do PDF contém exatamente esses 2 profiles.
   - Validar pelo menos mais uma empresa multi-contato existente (`Blux`) para comprovar que a correção é sistêmica.

5. **Entrega final**
   - Informar branch/commit local validado.
   - Informar explicitamente que o site publicado ainda não está com a versão corrigida até ser publicado novamente.
   - Listar arquivos/funções alterados e evidências objetivas dos dados reais.