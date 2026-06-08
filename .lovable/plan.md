# Reconectar Supabase via Lovable Cloud

## Objetivo
Restaurar a injeção automática de `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e **`SUPABASE_SERVICE_ROLE_KEY`** no runtime das server functions, eliminando o erro `Missing SUPABASE_SERVICE_ROLE_KEY` que bloqueia o login do admin (`comercial@kronedesign.com.br`) e demais fluxos administrativos.

## Pré-requisitos (a fazer antes da reconexão)
1. **Rotacionar o service_role** no painel do Supabase:
   - Acessar Supabase Dashboard → Project Settings → API → "Reset service_role secret"
   - Isso invalida a chave antiga que foi exposta no chat
   - Copiar a nova chave gerada (será usada apenas internamente pela Lovable Cloud, você não precisa colá-la em lugar nenhum)

## Passos da reconexão (UI Lovable)
1. Abrir **Project Settings** (engrenagem no canto superior direito do editor)
2. Ir até a aba **Cloud**
3. Localizar o card do Supabase conectado (projeto `wislupcekobgdizjduze`)
4. Clicar em **Reconnect** (ou Disconnect + Connect, se "Reconnect" não estiver visível)
5. Autorizar novamente o acesso da Lovable ao projeto Supabase
6. Aguardar a confirmação de que as três variáveis foram sincronizadas

## Validação pós-reconexão
1. Abrir o app em preview e tentar logar com `comercial@kronedesign.com.br`
2. Confirmar que o erro `Missing SUPABASE_SERVICE_ROLE_KEY` não aparece mais nos logs
3. Testar uma ação administrativa (ex.: buscar perfis em /admin) para validar que `supabaseAdmin` está funcionando

## O que NÃO precisa ser feito
- Nenhuma alteração de código — `src/integrations/supabase/client.server.ts` e `src/integrations/supabase/auth-middleware.ts` já leem `process.env.SUPABASE_*` corretamente
- Nenhum secret adicional (`APP_SUPABASE_*`) — a Opção B foi descartada em favor desta
- Nenhuma migração de banco

## Quando me avisar
Me responda assim que concluir os passos da UI (ou se aparecer algum erro durante a reconexão). Eu então rodo a validação dos logs/login com você.
