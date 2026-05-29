## Fase 2 — Perfis + Descoberta de Expositores

Objetivo: completar os perfis de visitante e expositor, e entregar a tela de descoberta (lista + busca + filtros + detalhe) que alimenta o agendamento da Fase 3.

### 1. Perfil — Visitante (`/profile`)
- Editar dados pessoais (`profiles`: full_name, preferred_language) e empresa (`companies`: trade_name, country_code, city, website, whatsapp, phone, linkedin, instagram).
- Editar `visitor_profiles`: buyer_type, interests_segments[], interests_services[], interests_destinations[], portfolio_pt, portfolio_es, notes.
- Multi-select com chips para arrays; valores controlados (segmentos/serviços/destinos) em constantes i18n.

### 2. Perfil — Expositor (`/profile`, mesma rota condicional por role)
- Mesma seção de empresa.
- Editar `exhibitor_profiles`: segments[], services[], destinations[], target_buyers[], pitch_pt, pitch_es, portfolio_pt, portfolio_es, materials_links[].
- Campo materials_links como lista dinâmica de URLs.

### 3. Descoberta — `/explore` (visitante)
- Lista de expositores (`exhibitor_profiles` + `profiles` + `companies` + `event_tables` para nº de mesa).
- Busca por nome/empresa (client-side sobre query inicial).
- Filtros por segments, services, destinations (multi-select).
- Cards com: empresa, país/cidade, mesa nº, chips de segmentos, CTA "Ver detalhes".
- Vazio/erro/skeleton states.

### 4. Detalhe do Expositor — `/exhibitor/$id`
- Header: empresa, país, mesa, idiomas.
- Seções: pitch (PT/ES conforme idioma do usuário), portfolio, segmentos/serviços/destinos, materiais (links), contato (site/linkedin/instagram).
- CTA "Agendar reunião" (desabilitado nesta fase, ativado na Fase 3).

### 5. Infra de suporte
- Server functions em `src/lib/profiles.functions.ts` e `src/lib/exhibitors.functions.ts` para reads/writes com `requireSupabaseAuth`.
- Hook `useExhibitors({ search, filters })` via TanStack Query.
- Constantes compartilhadas `src/lib/taxonomy.ts` (segments/services/destinations/buyer_types) com labels PT/ES.
- Componentes reutilizáveis: `MultiSelectChips`, `ExhibitorCard`, `FilterPanel`.
- Strings novas em `pt-BR.json` e `es.json`.

### Fora de escopo (Fase 3+)
- Agendamento, slots, conflitos, notificações, PDF, check-in, admin.

Confirma que sigo nessa direção?
