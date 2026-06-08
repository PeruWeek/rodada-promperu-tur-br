## Problema

O componente `PipelineDashboard` (`src/components/admin/pipeline/pipeline-tabs.tsx`) e as server functions (`src/lib/pipeline.functions.ts`) já existem e a migration já rodou, mas o componente **nunca foi adicionado** ao arquivo `src/routes/_authenticated/admin.tsx`. Por isso nada aparece no perfil admin nem no staff.

## O que será feito

Editar apenas `src/routes/_authenticated/admin.tsx` para expor a dashboard tanto para admin quanto para staff, sem mexer em nenhuma outra lógica.

### 1. Adicionar nova aba "Dashboard" (primeira aba, default)

Tanto no bloco staff (linhas 99–108) quanto no bloco admin (linhas 110–127):

- Adicionar `<TabsTrigger value="dashboard">Dashboard</TabsTrigger>` como **primeira** trigger
- Adicionar `<TabsContent value="dashboard"><PipelineDashboard isAdmin={...} /></TabsContent>`
- Trocar `defaultValue` para `"dashboard"` em ambos os `<Tabs>` para que abra direto nela
- Passar `isAdmin={false}` no bloco staff e `isAdmin={true}` no bloco admin (o componente já trata as diferenças: staff vê só sua carteira por padrão, admin tem toggle Todos/Meus)

### 2. Import

Adicionar no topo de `admin.tsx`:
```ts
import { PipelineDashboard } from "@/components/admin/pipeline/pipeline-tabs";
```

### 3. i18n (opcional nesta entrega)

Para manter consistência com as outras abas que usam `t("admin.tabs.*")`, posso adicionar a chave `admin.tabs.dashboard` em `pt-BR.json` e `es.json` e usar `{t("admin.tabs.dashboard")}` no trigger. Se preferir entrega mínima, deixo o label fixo "Dashboard" e adiciono a tradução depois.

## Fora do escopo

- Nenhuma mudança no backend, RLS, server functions ou no componente `PipelineDashboard` em si
- Nenhuma mudança em outras abas existentes (Mesas, Check-in, Staff, Usuários, Solicitações, E-mails)

## Resultado esperado

Ao abrir `/admin`:
- **Admin** vê a nova aba **Dashboard** (default) com Visão Geral, Cadastros, Agendamentos e Follow-up — com toggle Todos/Meus.
- **Staff** também vê a aba Dashboard como default, restrita à sua carteira por padrão.
