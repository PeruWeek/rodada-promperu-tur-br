## Plano de execução (aprovado)

### 1. Autorização confirmada pela sessão real
Já validado no banco:
- `rodada@promperu.tur.br` → `auth_user_id = 77e87bfc-117a-46fb-87f5-475803370080`
- `public.is_admin_or_staff(auth_user_id)` retorna `true`
- As RPCs administrativas já checam `is_admin_or_staff(auth.uid())` server-side via `requireSupabaseAuth`, então a autorização é feita pelo UUID da sessão, não pelo email.

### 2. Corrigir painéis em Admin > Empresas
Refatorar `OrphanExhibitorsPanel` e `UnpublishedExhibitorsPanel` para nunca sumirem silenciosamente. Sempre renderizar o cabeçalho do card e exibir 4 estados explícitos:

- **carregando**: skeleton dentro do card
- **erro**: bloco vermelho com mensagem `[admin_list_orphan_exhibitors] …` / `[admin_list_unpublished_exhibitors] …` + botão "Tentar novamente"
- **vazio real**: texto neutro ("Nenhum expositor sem empresa no momento." / "Todos os expositores com empresa estão publicados.")
- **lista**: registros como hoje

Adicionar também botão de refresh manual no cabeçalho de cada painel e `retry: 1` no `useQuery`. Isso elimina o caso "painel some sem feedback".

### 3. Invalidação cruzada de queries
Adicionar `useQueryClient` em `OrphanExhibitorsPanel` e chamar, após criar empresa para órfão ou após `LinkOrphanDialog.onLinked`:

```
queryClient.invalidateQueries({ queryKey: ["admin-orphan-exhibitors"] });
queryClient.invalidateQueries({ queryKey: ["admin-unpublished-exhibitors"] });
queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
```

Assim, ao vincular/criar empresa o expositor sai imediatamente de "órfãos" e aparece em "não publicados" (se sem mesa) ou na lista principal (se com mesa), sem reload.

### 4. Regularização operacional do Krone
Diagnóstico atual em produção:
- profile `de3f87be-…` (`comercial@kronedesign.com.br`) está **ativo**, tem **role exhibitor**, tem **exhibitor_profile**, e **já tem mesa #1 alocada no evento ativo**.
- O único bloqueio para `/explore` é `company_id IS NULL`.
- Existe a empresa `Kronedesign` (`bb5dfd4f-…`), porém já vinculada a outra pessoa (`Luiz Antonio Tibiriça`). Por ser decisão operacional (vincular à mesma empresa ou criar nova), **não vou tocar o dado por SQL manual** — a fixação deve ser feita pelo próprio admin via a UI corrigida no passo 2/3, usando a RPC `admin_link_orphan_to_company` (com `force=true` + motivo auditável se o hint de role bloquear) ou `admin_create_company_for_orphan`.

Caminhos disponíveis para o admin no Admin > Empresas após o deploy desta correção:
- **Opção A — vincular à empresa existente "Kronedesign"**: dialog de vínculo → buscar "krone" → se bloqueado pelo `role_hint`, usar "force link" com motivo (já implementado, auditado em `audit_logs` como `exhibitor.orphan_company_linked` com `force=true` e motivo).
- **Opção B — criar nova empresa "Krone Design"** para o Krone comercial: botão "Criar empresa" no painel de órfãos.

Em ambos os casos a RPC já roda em transação implícita do PostgREST e grava `audit_logs`. Após a ação, com a invalidação do passo 3, o Krone sai de órfãos e cai em `/explore` automaticamente (porque mesa já está alocada).

### 5. Critérios de revalidação
- Admin > Empresas mostra cabeçalho dos dois painéis mesmo vazios;
- erro de RPC aparece com mensagem visível e botão "Tentar novamente";
- após ação no Krone via UI: ele sai de "órfãos" sem reload;
- com mesa já alocada, aparece em `/explore` imediatamente;
- lista principal de empresas reflete a nova empresa/vínculo sem reload manual.

### Fora de escopo
- Edits em RPCs, RLS ou audit_logs (já estão coerentes em produção).
- Correção operacional do dado Krone via SQL — será feita pelo admin via UI corrigida, conforme regra "preferir RPC/UI".