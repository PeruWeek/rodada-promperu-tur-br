## Rodada — CRUD admin de expositores

Causa raiz da ambiguidade: "expositor" é um papel transversal, não
uma entidade. Operações estão distribuídas em Usuários (CRUD do
usuário/papel/ativo), Empresas (ficha comercial), Pré-cadastros (CSV)
e Solicitações (workflow). Nenhuma aba se chamava "Expositores", o
que dificultava a descoberta.

### Mudanças aplicadas

1. **Aba Usuários** — filtro por papel (Todos / Admin / Staff /
   Expositor / Visitante), botão **Power** para Ativar/Inativar
   diretamente na linha, tooltips/aria-labels nos 3 botões da linha
   (editar, ativar/inativar, excluir), texto-guia no topo explicando
   o escopo da aba.
2. **Diálogo "Novo usuário"** — legenda sob o seletor de papel
   indicando que "Expositor" cria um expositor.
3. **AlertDialog de exclusão** — texto reforçado: cascata definitiva,
   sugere inativar para preservar histórico.
4. **Aba Empresas** — `admin.companies.help` reescrito para deixar
   claro o escopo (ficha comercial) e direcionar criação/exclusão para
   Usuários.
5. **Aba Pré-cadastros** — subtítulo reescrito explicando que a conta
   de acesso real só é criada na confirmação do convite, e que para
   cadastro direto deve-se usar Usuários.
6. **Documentação** — `docs/admin-expositores.md` cobrindo regra,
   mapa de operações, fluxos passo a passo, diferença
   inativar × excluir, e checklist de QA.

### Arquivos alterados

- `src/routes/_authenticated/admin.tsx`
- `src/lib/i18n/pt-BR.json`
- `src/lib/i18n/es.json`
- `docs/admin-expositores.md` (novo)
- `.lovable/plan.md`

### Fora de escopo

- Sem aba "Expositores" separada.
- Sem nova entidade, migration, RLS, trigger ou endpoint.
- Sem alteração em CompaniesTab/PreRegistrationsTab além das strings
  i18n já consumidas por `t("admin.companies.help")` e
  `t("admin.preRegistration.subtitle")`.

### Validação manual

1. Logar como admin, ir em **Admin → Usuários**: ver o hint no topo,
   o filtro de papel e o botão Power em cada linha.
2. Trocar o filtro para **Expositor**: lista mostra apenas
   expositores.
3. Clicar **Novo usuário**: ver a legenda sob o seletor de papel.
4. Clicar **Power** em um usuário não-próprio: badge "Inativo" alterna
   imediatamente.
5. Clicar lixeira (admin): diálogo mostra texto reforçado sobre
   cascata.
6. **Admin → Empresas**: hint no topo direciona criação para Usuários.
7. **Admin → Pré-cadastros**: subtítulo explica o fluxo de
   confirmação.
8. Trocar idioma para ES: todos os textos novos aparecem traduzidos.