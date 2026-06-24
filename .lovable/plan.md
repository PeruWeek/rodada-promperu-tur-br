# Diagnóstico corrigido: `selukaw8995@aquas.live`

Erro na investigação anterior: fiz join em `user_roles.user_id = profiles.id` quando o correto é `= profiles.auth_user_id`. Refeito com o join certo.

## Status real

| Verificação | Resultado |
|---|---|
| `auth.users` | OK — `e7278995-a149-4281-b882-4ab79d33972f` |
| `profiles` | OK — `94b07786…`, `full_name: "teste 8"`, `company_id: e84f58c6…` |
| `visitor_profiles` | OK — `signup_completed_at: 2026-06-24 19:14:42.364Z` |
| `user_roles` | OK — `visitor` |
| **Cadastro buyer concluído** | **SIM, em 19:14:42** (2s após signup) |
| `user_metadata.welcome_email_sent_at` | null |
| `email_send_log` (qualquer template, qualquer status) | 0 linhas |
| `suppressed_emails` | 0 linhas |
| SendGrid | nada para inspecionar — request nunca saiu |

`complete_buyer_signup` rodou com sucesso. O e-mail simplesmente nunca foi tentado.

## Causa raiz

O disparo do welcome está acoplado a **um único caminho**: o branch de sucesso do auto-finalizador em `src/routes/onboarding.tsx`, dentro do `useEffect` que consome `BUYER_SIGNUP_STORAGE_KEY` / `user_metadata.buyer_signup_payload`. Para esse código rodar e enviar o e-mail, todas as condições abaixo precisam ser verdadeiras na **mesma sessão de browser** logo após o signup:

1. O bundle publicado no momento já contém o código de dispatch (feature recente).
2. O payload do buyer estava em `sessionStorage` ou em `user_metadata` quando o usuário aterrissou em `/onboarding`.
3. `complete_buyer_signup` retornou OK na mesma execução do efeito.
4. `supabase.auth.getSession()` devolveu um `access_token`.
5. O `fetch('/lovable/email/transactional/send')` não falhou silenciosamente.

Branches em que o welcome **nunca dispara hoje**, mesmo com cadastro completo:

- Submit manual via formulário (`onSubmit` em `onboarding.tsx`): chama `setBuyerSuccess(true)` e **não** invoca o dispatch.
- Usuário concluiu o buyer numa sessão anterior (antes do deploy do dispatch, ou antes de ter `welcome_email_sent_at` como gate) e volta depois — efeito não roda porque `profile.company_id` já existe e a página redireciona para `/agenda`.
- `complete_buyer_signup` retornou sucesso mas o `fetch` do welcome lançou exceção de rede ou non-2xx: vira `console.warn`, sem retry, sem persistência da intenção.
- Bundle servido no momento do signup ainda não tinha o código do welcome (feature publicada depois) — caso provável deste usuário, dado que o signup é de 19:14:40 e o feature de welcome é recente.

Resultado: qualquer caminho que não seja "auto-finalizador, primeiro signup, mesma sessão, tudo no happy path" não envia o e-mail. Foi exatamente o que ocorreu com `selukaw8995@aquas.live`.

## Correção

### 1. Desacoplar o envio do welcome
Criar um helper único e idempotente:

`src/lib/buyer-welcome-email.ts`
```ts
export async function ensureBuyerWelcomeEmail(opts: {
  userId: string;
  email: string;
  fullName: string | null;
  alreadySentAt?: string | null;
}): Promise<void>
```
Responsabilidades:
- short-circuit se `alreadySentAt` estiver presente.
- buscar `access_token` via `supabase.auth.getSession()`.
- POST `/lovable/email/transactional/send` com `templateName: 'buyer-welcome'`, `idempotencyKey: 'buyer-welcome-<userId>'`, `templateData: { visitorName, agendaUrl }`.
- em `res.ok`, gravar `welcome_email_sent_at` em `user_metadata`.
- nunca lançar — apenas `console.warn`.

### 2. Acionar o helper em todos os pontos de "buyer completo"
- `src/routes/onboarding.tsx` (auto-finalizador): substitui o bloco inline atual pela chamada ao helper.
- `src/routes/onboarding.tsx` (`onSubmit` manual, branch `visitor`): chama o helper antes de `setBuyerSuccess(true)`. (Hoje não chama — esse é um dos branches faltantes.)
- `src/routes/_authenticated/agenda.tsx`: no mount, se `profile?.roles` inclui `visitor`, `profile.company_id` está setado e `user.user_metadata.welcome_email_sent_at` está vazio, chama o helper. Cobre usuários legados como `selukaw8995@aquas.live` automaticamente na próxima visita à agenda.

Idempotência garantida em duas camadas: gate por `welcome_email_sent_at` no cliente + `idempotencyKey` único por usuário no servidor (deduplicado em `email_send_log`).

### 3. Reenvio manual seguro (admin-only)
Em `src/lib/email-admin.functions.ts`, adicionar:

```ts
export const resendBuyerWelcome = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    userId: z.string().uuid(),
    force: z.boolean().optional(),
  }).parse)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // supabaseAdmin.auth.admin.getUserById(data.userId) → email + metadata
    // profiles.full_name pelo auth_user_id
    // POST interno para /lovable/email/transactional/send
    // idempotencyKey: force ? `buyer-welcome-${userId}-${Date.now()}` : `buyer-welcome-${userId}`
    // em sucesso: supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { welcome_email_sent_at: now } })
  });
```

Botão "Reenviar boas-vindas" em `src/components/admin/registrants-tab.tsx` na linha do buyer, com confirmação. `force` exposto como checkbox no diálogo.

### 4. Ação imediata para `selukaw8995@aquas.live`
Após implementar (2) e (3):
- Opção A — automática: na próxima vez que ele abrir `/agenda` (autenticado), o helper detecta `welcome_email_sent_at` ausente e dispara. Nada a fazer manualmente. Usuário pode estar inativo, então não é garantido.
- Opção B — manual: admin clica "Reenviar boas-vindas" no painel. Garante envio agora.

Recomendo executar a opção B para esse usuário assim que o reenvio admin estiver pronto.

## Arquivos alterados
- novo: `src/lib/buyer-welcome-email.ts` (helper compartilhado)
- editado: `src/routes/onboarding.tsx` (auto-finalizador chama helper; `onSubmit` visitor chama helper antes do success)
- editado: `src/routes/_authenticated/agenda.tsx` (chamada idempotente no mount para visitors completos sem `welcome_email_sent_at`)
- editado: `src/lib/email-admin.functions.ts` (server fn `resendBuyerWelcome`)
- editado: `src/components/admin/registrants-tab.tsx` (botão de reenvio + diálogo com `force`)

Sem mudanças em template, registry, rota `send.ts`, fluxos de expositor/admin/staff/cliente, copy da tela de sucesso, `/agenda` em si ou Supabase Auth.

## Critérios de aceite
- Qualquer visitor com `signup_completed_at` preenchido e sem `welcome_email_sent_at` recebe o welcome no máximo no próximo acesso a `/agenda`.
- Reabrir `/agenda` várias vezes não duplica envio (gate cliente + idempotency key servidor).
- Submit manual (não-wizard) também dispara.
- Admin consegue reenviar manualmente; com `force`, supera a idempotência para casos legítimos (recipient apagou e pediu de novo).
- Nenhuma alteração observável para expositor/admin/staff/cliente.
