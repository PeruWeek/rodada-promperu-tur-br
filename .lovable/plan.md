### Problema
O usuário quer rearranjar os links na tela de login:  
- Remover o link **"Esqueci minha senha"** que está abaixo do campo de senha.  
- Colocar **"Esqueci minha senha"** logo abaixo do link **"Não tem conta? Cadastre-se"**.  
- Remover o link **"Voltar para o início"** que foi adicionado anteriormente (o usuário não pediu isso).  

### Arquivos
- `src/routes/login.tsx` — mover o `<Link to="/forgot-password">` para abaixo do `<Link to="/signup">` e remover o `<Link to="/">`.
- `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json` — remover as chaves `auth.backToHome` que foram adicionadas sem necessidade.

### Resultado esperado
Ordem dos links no final do formulário:
1. Não tem conta? Cadastre-se
2. Esqueci minha senha

Nada mais abaixo do campo de senha.