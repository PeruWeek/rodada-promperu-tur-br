## Problemas

1. **Tela pós-cadastro confusa** — o título "Cadastro para a Rodada de Negócios!" + subtítulo continuam visíveis acima do card "Cadastro recebido! Verifique seu e-mail", duplicando a mensagem.
2. **Onboarding pede dados de novo** — o payload do wizard de 5 passos é salvo apenas em `sessionStorage`. Quando o usuário abre o link de confirmação em outro navegador/aba/dispositivo, `sessionStorage` está vazio → `/onboarding` cai no formulário manual de "Conte-nos quem você é" (empresa/país/cidade).
3. **Perfil incompleto** — como o caminho manual rodou (em vez de `complete_buyer_signup`), apenas `companies.trade_name/country/city` foram gravados; CNPJ, UF, telefone, WhatsApp, cargo, buyer_type, segmentos, serviços, destinos, portfólio e consentimentos ficaram perdidos.

## Mudanças

### 1) `src/routes/signup.tsx` — limpar a tela de sucesso
Quando `sent === true`, esconder o `<h1>` ("Cadastro para a Rodada…") e o `<p>` de subtítulo. Renderizar apenas o card de sucesso com:
- Título: **"Registro realizado com sucesso!"** (nova chave i18n `auth.signupSuccessTitle`)
- Corpo atual ("Enviamos um link de confirmação para {{email}}…") e o hint.

### 2) `src/routes/signup.tsx` — persistir o payload no `user_metadata`
No `onFinish`, além de `sessionStorage`, passar o payload inteiro também em `options.data.buyer_signup_payload`:

```ts
options: {
  emailRedirectTo: `${window.location.origin}/onboarding`,
  data: {
    full_name: data.full_name,
    preferred_language: data.preferred_language,
    buyer_signup_payload: payload,  // <—
  },
}
```

Isso garante que o payload viaje com o `auth.users` e fique disponível em qualquer dispositivo após confirmar o e-mail.

### 3) `src/routes/onboarding.tsx` — ler o payload do `user_metadata` como fallback
Antes de mostrar o seletor visitante/expositor, tentar nesta ordem:
1. `sessionStorage[BUYER_SIGNUP_STORAGE_KEY]` (já existe);
2. `user.user_metadata.buyer_signup_payload` (novo fallback);
Se qualquer um existir → chamar `complete_buyer_signup`, limpar sessionStorage, invalidar queries, `navigate({ to: "/agenda" })`. Mostrar tela "Carregando…" enquanto roda.

Resultado: o link de confirmação leva direto para `/agenda`, sem reabrir onboarding nem perder dados — independente do dispositivo/navegador.

### 4) `src/lib/i18n/pt-BR.json` e `es.json`
Adicionar `auth.signupSuccessTitle`:
- pt-BR: `"Registro realizado com sucesso!"`
- es: `"¡Registro realizado con éxito!"`

E ajustar `auth.checkEmailTitle` para virar subtítulo do card (ou removê-lo, já que o novo título cumpre o papel).

## Escopo / fora do escopo

- Não mexe em RPCs, schema, RLS, e-mails transacionais nem no fluxo de expositor.
- Não toca em `/admin` nem em `admin-auth.functions.ts`.
- Usuários que já passaram pelo bug manual continuam podendo completar dados em `/profile` normalmente — esta mudança previne o problema para novos cadastros.

## Caso atual (Krone)
Como a conta `comercial@kronedesign.com.br` já passou pelo fluxo quebrado, a recuperação dela é manual em `/profile` (ou refazendo o cadastro após excluir o usuário no `/admin → E-mails`). A correção evita que isso aconteça com os próximos.
