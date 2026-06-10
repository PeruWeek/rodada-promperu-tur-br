# Gestão de Expositores — Painel Admin

## Regra de negócio

**Expositor não é uma entidade própria.** É o papel `app_role = 'exhibitor'`
atribuído a um usuário (`profiles` + `user_roles`). A ficha comercial do
expositor vive em `exhibitor_profiles` e é criada automaticamente por
trigger (`ensure_exhibitor_profile_on_role`) quando o papel passa a ser
`exhibitor`. A empresa do expositor vive em `companies`, vinculada ao
`profile.company_id`.

Consequência prática: todo CRUD de expositor é, na verdade, CRUD de
usuário (papel) + edição da empresa associada.

## Mapa de operações

| Operação | Aba | Componente / botão |
|---|---|---|
| Criar expositor manual | **Usuários** | Botão "Novo usuário" → papel = Expositor |
| Importar em massa (pré-cadastros) | **Pré-cadastros** | Modelo CSV + Importar |
| Aprovar pedido feito pelo próprio expositor | **Solicitações** | Aprovar / Rejeitar |
| Editar nome, idioma, papel, empresa básica, ativo | **Usuários** | Ícone lápis |
| Editar ficha comercial completa (segmentos, destinos, pitch, materiais) | **Empresas** | Botão "Editar" |
| Inativar / Ativar (soft) | **Usuários** | Botão Power (toggle na linha) |
| Excluir físico (cascade) | **Usuários** | Ícone lixeira (somente admin) |

## Fluxos oficiais

### 1. Criar expositor manualmente

1. Acesse **Admin → Usuários**.
2. Clique em **Novo usuário**.
3. Preencha e-mail, senha provisória, nome completo, idioma.
4. Em **Papel**, selecione **Expositor**.
5. Confirme.

O sistema cria o usuário no Auth (já confirmado), cria o registro em
`profiles`, atribui `user_roles.role = 'exhibitor'` e o trigger
`ensure_exhibitor_profile_on_role` cria a linha em `exhibitor_profiles`.
A empresa do expositor é vinculada depois, via **Usuários → Editar** ou
via **Empresas → Editar**.

### 2. Criar expositores por importação (CSV)

1. Acesse **Admin → Pré-cadastros**.
2. Selecione o evento.
3. Baixe o **modelo CSV** e preencha conforme cabeçalhos.
4. Clique em **Escolher arquivo**, selecione o CSV preenchido.
5. Clique em **Importar**.
6. Confira o relatório (criados / atualizados / ignorados / erros).

Importante: a importação cria apenas o **pré-cadastro**. A conta de
acesso (Auth user) só é criada quando a pessoa confirma o convite pelo
mesmo e-mail. Para criar conta com login imediato, use o fluxo manual em
**Usuários**.

### 3. Aprovar pedido externo

Quando o expositor solicita inclusão pelo formulário público, o pedido
entra em **Admin → Solicitações** com status `pending`. O admin/staff
aprova ou rejeita. Aprovar promove o papel para `exhibitor`.

### 4. Editar dados de expositor

- **Dados pessoais / papel / empresa básica / ativo:** **Usuários** →
  ícone lápis.
- **Ficha comercial completa:** **Empresas** → botão **Editar**. O
  drawer abre com abas Empresa / Contato / Expositor (segmentos,
  destinos, serviços, perfis de comprador-alvo, pitch PT/ES, portfólio
  PT/ES, links de materiais).

### 5. Inativar expositor (soft delete — preferencial)

1. **Admin → Usuários**.
2. Localize o usuário (use o filtro de papel = Expositor).
3. Clique no botão **Power** na linha do usuário.

O usuário fica com `is_active = false`. Não pode mais logar (badge
"Inativo" aparece na lista). Reuniões e histórico são preservados.
Reverter é o mesmo botão.

### 6. Excluir expositor (hard delete — definitivo)

1. **Admin → Usuários**. Somente admin tem o botão.
2. Ícone lixeira na linha do usuário.
3. Confirme no diálogo. A mensagem explica que é exclusão definitiva em
   cascata.

Remove o usuário do Auth e cascade no banco (profile, user_roles,
exhibitor_profiles, meetings vinculadas como visitante, etc.). **Use
apenas para casos de duplicidade, teste ou exclusão jurídica
(LGPD).** Para qualquer outro caso, prefira **Inativar**.

## Diferença Inativar × Excluir

| Inativar | Excluir |
|---|---|
| Reversível | Definitivo |
| Preserva histórico, reuniões, auditoria | Apaga em cascata |
| Bloqueia login | Remove usuário do Auth |
| Qualquer admin/staff | Apenas admin |
| Default recomendado | Exceção (LGPD, duplicidade, teste) |

## Critérios de aceite QA

- [ ] Em **Usuários**, é possível filtrar por papel = Expositor e ver
  somente expositores.
- [ ] Botão **Novo usuário** abre diálogo com seletor de papel; com a
  legenda indicando que Expositor cria um expositor.
- [ ] Criar um usuário com papel Expositor: registro aparece em
  Usuários (com badge correto) e em Empresas (quando associado a uma
  empresa).
- [ ] Editar via Usuários altera nome/idioma/papel/empresa básica/ativo.
- [ ] Editar via Empresas altera segmentos, pitch, materiais.
- [ ] Botão Power na linha alterna ativo/inativo; o badge "Inativo"
  aparece/some sem precisar recarregar.
- [ ] Diálogo de exclusão exibe mensagem reforçada sobre cascata e
  sugere inativar.
- [ ] Importação CSV em Pré-cadastros gera linhas no relatório e não
  cria Auth user até a confirmação do convite.
- [ ] Em PT-BR e ES, todos os hints e textos aparecem traduzidos.

## Fora de escopo desta entrega

- Não foi criada aba "Expositores" separada. Papel é transversal —
  duplicar UI gera ambiguidade pior.
- Não foi alterada nenhuma migration, RLS, política ou trigger. A
  estrutura atual já cobre o fluxo.
- Não foram criados novos endpoints/server functions.