## Diagnóstico real (verificado direto no banco)

Consultei o banco de produção via `psql` e o estado real **não bate** com o que aparece em tela:

1. **RPCs admin já estão corretas no DB** — `pg_get_functiondef` mostra:
   - `admin_list_orphan_exhibitors`: usa `p.id::uuid AS profile_id` (sem ambiguidade), assinatura completa.
   - `admin_list_unpublished_exhibitors`: `RETURNS TABLE(...)` bate com o `SELECT` (profile_id, email, full_name, trade_name, reason, created_at).
   - Não há duplicatas de função (`pg_proc` retorna 1 linha cada).

2. **Krone já está vinculado no DB:**
   - `profiles.id = de3f87be...`, `company_id = 6d69e864... (Kronedesign Comunicação Digital)`, `is_active = true`, role `exhibitor`, mesa `#1` alocada no evento ativo, `exhibitor_profiles` populado com segmentos/serviços/destinos.
   - Existe uma **empresa duplicada** `bb5dfd4f... (Kronedesign)` sem `legal_name` e sem profile vinculado — resíduo de tentativa anterior. Quando o admin abre essa entrada pelo nome, o drawer aparece "sem expositor/sem dono" e dá a impressão de "Empresa vazia".

3. **`public_exhibitor_catalog()`** filtra por `is_active`, `company_id`, role `exhibitor` e mesa no evento ativo — todas as condições já passam para o Krone. Deveria aparecer em `/explore`.

Conclusão: os fixes de migração da rodada anterior já estão no banco, mas a UI continua vendo os erros antigos. O padrão típico é **cache de schema do PostgREST não invalidado** (a Data API responde com a assinatura antiga até receber `NOTIFY pgrst, 'reload schema'`). E a empresa duplicada Kronedesign confunde o operador.

## Plano

### 1. Forçar refresh do cache do PostgREST e re-emitir as RPCs (migração)

- `CREATE OR REPLACE` idempotente das duas funções (mesmo corpo já corrigido), garantindo bump de `oid` e schema cache.
- `NOTIFY pgrst, 'reload schema';` na mesma migração para forçar PostgREST a recarregar imediatamente.
- Re-aplicar `GRANT EXECUTE ... TO authenticated, service_role` e `REVOKE ... FROM anon, public` (defensivo).

### 2. Limpar a empresa duplicada do Krone (migração, mesma transação)

- Confirmar que `bb5dfd4f-5d54-40bc-8398-d16ca6eed8c5` (`Kronedesign`) **não** tem `profiles`, `company_event_pipeline` nem `meetings` vinculados.
- Se limpo: `DELETE FROM companies WHERE id = 'bb5dfd4f...'` registrando em `audit_logs` (`action = 'company.dedupe_delete'`, `actor = auth.uid()` via `current_setting` ou `NULL` com nota "dedupe migration").
- Se houver qualquer referência: **abortar a exclusão** e apenas renomear `trade_name` para `Kronedesign (duplicado — não usar)` para evitar confusão na UI, também registrando em `audit_logs`.

### 3. Verificar UI do drawer e listagem de empresas

- Em `companies-tab.tsx` / `edit-company-drawer.tsx`, conferir que a query lista empresas por `id` (não por `trade_name`) e que após a limpeza/dedupe a `useQueryClient.invalidateQueries(["admin-companies"])` é chamada — já está no fluxo `onLinked` dos painéis novos. Sem mudança de comportamento, apenas validação.
- Garantir que `getCompanyForEdit` retorna os profiles vinculados à `company.id` correta (o `Empresa vazio` reportado é, na prática, o admin abrindo o registro duplicado `bb5dfd4f`).

### 4. Revalidação pós-deploy

Após a migração aprovada e executada:

- `/explore` (qualquer usuário logado) deve listar o Krone imediatamente — `public_exhibitor_catalog` já retorna ele no DB.
- `Admin > Empresas` deve carregar os dois painéis sem erro `ambiguous` nem `structure of query`.
- O painel "Expositores sem empresa" deve estar **vazio** (Krone tem company_id).
- O painel "Não publicados" também deve estar vazio para o Krone (tem mesa, tem role, ativo).
- Edição do Krone no admin abre a empresa única `Kronedesign Comunicação Digital` com o expositor Antonio listado.

### Detalhes técnicos

```sql
-- Re-emit RPCs (mesmo corpo já corrigido) para bump de oid
CREATE OR REPLACE FUNCTION public.admin_list_orphan_exhibitors() ...;
CREATE OR REPLACE FUNCTION public.admin_list_unpublished_exhibitors() ...;

REVOKE ALL ON FUNCTION public.admin_list_orphan_exhibitors() FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_list_unpublished_exhibitors() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() TO authenticated, service_role;

-- Dedupe Krone (guard-rail: só apaga se não houver refs)
DO $$
DECLARE v_refs int;
BEGIN
  SELECT count(*) INTO v_refs FROM (
    SELECT 1 FROM profiles WHERE company_id = 'bb5dfd4f-5d54-40bc-8398-d16ca6eed8c5'
    UNION ALL SELECT 1 FROM company_event_pipeline WHERE company_id = 'bb5dfd4f-...'
    UNION ALL SELECT 1 FROM meetings WHERE company_id = 'bb5dfd4f-...'
  ) s;
  IF v_refs = 0 THEN
    DELETE FROM companies WHERE id = 'bb5dfd4f-...';
    INSERT INTO audit_logs(action, entity, entity_id, metadata)
    VALUES ('company.dedupe_delete','companies','bb5dfd4f-...',
            jsonb_build_object('reason','duplicate of 6d69e864 (Krone)'));
  ELSE
    UPDATE companies SET trade_name = 'Kronedesign (duplicado — não usar)'
    WHERE id = 'bb5dfd4f-...';
    INSERT INTO audit_logs(action, entity, entity_id, metadata)
    VALUES ('company.dedupe_rename','companies','bb5dfd4f-...',
            jsonb_build_object('refs', v_refs));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
```

Nenhuma alteração de UI é necessária além das já entregues na rodada anterior (painéis com loading/error/empty + `invalidateQueries`). O bloqueio é puramente de cache do PostgREST + dado duplicado.