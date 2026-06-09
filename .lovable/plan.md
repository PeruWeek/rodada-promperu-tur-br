## Resumo
Adicionar um link de retorno à página inicial (`/`) abaixo do link "Não tem conta? Cadastre-se" na tela de login, com suporte a internacionalização (PT-BR/ES).

## Alterações
1. **i18n** — Adicionar chave `backToHome` nos arquivos `pt-BR.json` e `es.json` dentro da seção `auth` (ou `common`).
2. **Login page** — Inserir um parágrafo com `<Link to="/">` abaixo do link de cadastro em `src/routes/login.tsx`.

## Validação
- Acessar `/login` e confirmar que o novo link "Voltar para o início" aparece abaixo de "Não tem conta? Cadastre-se".
- Verificar que o link direciona corretamente para a home.