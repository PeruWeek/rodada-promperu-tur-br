## Problema

O cadastro foi feito com typo: `comecial@kronedesign.com.br` (faltando o "r"). Por isso o e-mail de confirmação nunca chega — o endereço não existe — e o reenvio também falha pelo mesmo motivo.

Registro encontrado:
- ID: `fc6845a3-195a-4d70-a029-9be08f12f0cb`
- E-mail: `comecial@kronedesign.com.br`
- Criado em: 05/06/2026 21:59
- Sem confirmação, sem login

## Ação

Apagar o usuário de `auth.users`. Como há `ON DELETE CASCADE` no trigger `handle_new_user`, isso também remove o `profile` e o `user_role` associados criados automaticamente. Nenhum dado adicional (empresa, agenda, reunião) foi criado, então não há nada mais a limpar.

Depois disso, você refaz o cadastro normalmente em `/signup` usando o e-mail correto `comercial@kronedesign.com.br` e o e-mail de confirmação será enviado para o endereço certo.

## Observação

Não é necessária nenhuma alteração de código — é só limpeza pontual de dados. Se quiser, num próximo passo a gente pode adicionar uma confirmação visual do e-mail no formulário de cadastro (campo "confirmar e-mail" ou checagem de domínios suspeitos) para evitar typos futuros, já que a meta é minimizar erros no cadastro de inscritos.
