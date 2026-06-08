## Contexto
O usuário informou que o cadastro de expositores será feito exclusivamente pelo admin ou via importação direta no banco de dados. Portanto, o aviso exibido no dashboard do expositor quando ele ainda não possui mesa atribuída não é mais necessário.

## Alteração
1. Remover o bloco condicional que exibe o aviso `dashboard.awaitingTable` do arquivo `src/routes/_authenticated/dashboard.tsx` (linhas 40–44).
2. Avaliar se a query `hasTable` ainda é necessária; se não houver outro uso, remover também para limpar o código.

## Resultado esperado
O dashboard do expositor não exibirá mais o aviso amarelo de "Aguardando atribuição de mesa pela organização".