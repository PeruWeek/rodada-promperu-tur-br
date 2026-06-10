
## Causa raiz

Os sintomas (admin abrindo nav de visitante, `Perfil` indo pra `/login`, `PT/ES` e switches sem clique, dropdown abrindo "vazio", React #418, mistura PT/ES) têm **uma única origem**: a árvore `/_authenticated/*` está rodando em SSR sem sessão.

1. **`src/routes/_authenticated.tsx` não tem `ssr: false`.** A sessão Supabase mora em `localStorage` (lado cliente). No SSR:
   - `beforeLoad` chama `supabase.auth.getUser()` sem token e tenta `redirect → /login` (causa o "redireciona pra /login" intermitente no `Perfil`).
   - `useAuth`/`useProfile` retornam `{user:null, loading:true}` no servidor e algo diferente no cliente → **hydration mismatch = React error #418**.
   - Quando #418 dispara, o React remonta a subárvore client-side e os **portais do Radix (Select/Dialog/AlertDialog)** ficam dessincronizados: o `body` herda `pointer-events:none` de um overlay fantasma → switches, botões PT/ES e itens do Select aparecem mas não recebem clique, dropdown "abre e não mostra opções" (o `SelectContent` está renderizado num portal coberto).

2. **`SiteHeader` cai no default "visitor"** enquanto `useProfile` ainda está carregando. `getPrimaryRole(undefined) === null` → o switch cai no `return [visitor nav]`. Resultado: logo após o login admin, o header pisca "Explorar / Mi Agenda" antes de virar "Admin / Perfil". Some quando o usuário abre o menu (re-render) — exatamente o sintoma relatado.

3. **i18n misturado**: o mesmo race acima faz o `i18n.changeLanguage` rodar antes do profile carregar; alguns textos vêm do default (ES) e outros do estado já trocado (PT).

Os filtros (`Últimos 30 dias`, `Apenas minha carteira`) **estão corretos no código** (`pipeline-tabs.tsx` linhas 87–101 têm opções reais 7/30/90/365 e o `Switch` está bem cabeado). Eles só parecem quebrados porque o portal está atrás do overlay travado.

## O que vai ser alterado

### 1. `src/routes/_authenticated.tsx` — desligar SSR da subárvore protegida
- Adicionar `ssr: false` no `createFileRoute("/_authenticated")`.
- Manter `beforeLoad` (só roda no cliente agora; `getUser()` enxerga o `localStorage` corretamente, sem redirect espúrio).
- Continuar com o `useEffect` de gating por role, mas só disparar depois de `profile` resolvido (já é o caso; só ficará confiável após eliminar o SSR).

Isso elimina:
- React #418 na subárvore (não há mais render no servidor para comparar).
- O `pointer-events:none` herdado de portais Radix mal hidratados.
- O flash do "Perfil → /login".

### 2. `src/components/site-header.tsx` — não cair no default "visitor" enquanto carrega
- Pegar `isLoading` do `useProfile()`.
- Enquanto `loading || (user && profileLoading)`, renderizar `navItems = []` (header mostra só logo + LanguageSwitcher + Sair). Sem flash de nav de visitante para admin/staff/exhibitor.
- Para `primaryRole === null` **mas com profile já carregado**, manter o fallback atual (onboarding fluxo).

### 3. `src/components/site-header.tsx` — `Perfil` consistente para todos os papéis com perfil
- Já está correto para admin/exhibitor/visitor; staff continua sem link (regra de produto existente). Sem mudança funcional além do gate de loading.

### 4. `src/components/language-switcher.tsx` — não engasgar quando o profile ainda não carregou
- Hoje o `change()` chama `supabase.from('profiles').update(...)` mesmo se o profile do user ainda não existe; em alguns paths a Promise pendura e o botão fica "sem efeito". Tornar o `update` fire-and-forget (sem `await` bloqueando) e aplicar `i18n.changeLanguage` + `localStorage` imediatamente, para o clique sempre refletir na UI mesmo sob race.

### 5. `src/routes/_authenticated/admin.tsx` — limpeza defensiva de Dialog/AlertDialog
- Garantir que `Dialog` de "renumerar mesa" e `AlertDialog` de "excluir mesa" sempre fechem em `onOpenChange={(o) => !o && setX(null)}` (já estão), e que **nenhum** componente filho monte um portal condicionalmente sem `Dialog` wrapper. Auditoria rápida; provavelmente nada a mudar aqui — incluído só para fechar a causa de "portal travado" caso reapareça.

## Checklist de aceite (validação manual)

1. Login com conta admin → ir direto pra `/admin`, dashboard "Administración" aparece de cara, **sem** flash de "Explorar / Mi Agenda" no header.
2. Clicar em `Perfil` → abre `/profile` do admin, sem ir pra `/login`.
3. Botões `PT` e `ES` no header trocam o idioma imediatamente.
4. Aba **Dashboard → Visão Geral**: switch `Apenas minha carteira` alterna; Select `Últimos 30 dias` abre e troca para 7/30/90/365 dias, KPIs recarregam.
5. Console limpo: **sem** `Minified React error #418`.
6. Idioma do admin permanece consistente (PT-BR ou ES) em toda a área.
7. Logout segue funcionando; refresh em `/admin` mantém sessão (não vai pra `/login`).

## Detalhes técnicos

- `ssr: false` é o padrão recomendado para subárvores autenticadas via Supabase (sessão em `localStorage`). O resto do app (rotas públicas, `/login`, `/signup`, home) continua SSR normal.
- Não toco em arquivos auto-gerados (`integrations/supabase/*`, `routeTree.gen.ts`).
- Não toco no fluxo de login/signup/logout/reset-password.
- Sem mudança de schema, sem nova migration.

## Fora de escopo

- Reorganizar `_authenticated.tsx` para o layout `_authenticated/route.tsx` da integração (refator estrutural maior; não necessário para corrigir os sintomas).
- Reescrever `pipeline-tabs.tsx` — os controles já estão corretos.
