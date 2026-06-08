Trocar os campos de senha na aba "Segurança" da página de perfil para usar o componente `PasswordInput` (com ícone de olhinho), igual aos demais campos de senha do app.

Arquivo: `src/routes/_authenticated/profile.tsx`
- Substituir os dois `<Input type="password" ...>` do `PasswordCard` por `<PasswordInput ...>`
- Adicionar o import do `PasswordInput`