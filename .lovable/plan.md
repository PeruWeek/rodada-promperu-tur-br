## Problema

O CNPJ digitado (`11.229.910/0001-67`) é matematicamente válido, mas o formulário marca como inválido. A causa é um bug em `src/lib/validation/br-masks.ts` na função `isValidCNPJ`:

```ts
let pos = len + 1;   // ← errado: começa em 13 para 12 dígitos
```

O algoritmo oficial usa pesos `5,4,3,2,9,8,7,6,5,4,3,2` (e `6,...,2` para o 2º dígito), ou seja, `pos` deve começar em `len - 7` (5 para o 1º DV, 6 para o 2º). Com `len + 1` os pesos viram `13,12,11,...`, fazendo CNPJs válidos serem rejeitados.

## Correção

Em `src/lib/validation/br-masks.ts`, na função `calc` dentro de `isValidCNPJ`:

- trocar `let pos = len + 1;` por `let pos = len - 7;`

Nenhuma outra mudança é necessária — a lógica de redução de `pos` para 9 quando `< 2`, formatação e validações de telefone/UF permanecem iguais.

## Verificação

Após a alteração, validar:
- `11.229.910/0001-67` → válido (passa no Passo 2)
- CNPJs claramente inválidos (ex.: `11.111.111/1111-11`, dígitos errados) continuam rejeitados
