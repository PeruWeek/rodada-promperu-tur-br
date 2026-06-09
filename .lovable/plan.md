## O que será adicionado em `/admin`

### 1) Aba "Empresas" (nova) — editar visitantes e expositores

Uma única lista de empresas (com filtro Visitante / Expositor / Todos) onde o admin clica em **Editar** e abre um drawer com **abas** equivalentes ao onboarding:

- **Empresa** — `companies`: trade_name, legal_name, tax_id, registration_id, país, estado, cidade, endereço, website, instagram, linkedin, general_phone, specialty, import_profile.
- **Contato principal** — `profiles` do dono: full_name, job_title, phone, whatsapp, e-mail (somente leitura), idioma.
- **Visitante** (se a empresa for visitante) — `visitor_profiles`: buyer_type, interests_segments, interests_destinations, interests_destinations_free, interests_services, demand_profile, portfolio_pt/es, notes, consent_marketing, additional_contacts.
- **Expositor** (se for expositor) — `exhibitor_profiles`: segments, destinations, services, target_buyers, pitch_pt/es, portfolio_pt/es, materials_links.

Botão **Salvar** persiste tudo via uma server fn admin (`updateCompanyFull`) usando `supabaseAdmin` (bypass RLS, gravando audit). Os mesmos componentes de chips/multi-select usados no onboarding serão reaproveitados para manter consistência.

### 2) Aba "Mesas" — passa a permitir criar / renumerar / excluir

Na aba já existente:

- **+ Nova mesa**: cria uma `event_tables` no evento ativo. Número sugerido = `max(table_number)+1`, editável.
- **Editar número** (ícone lápis em cada linha): troca `table_number`. Bloqueia se já existir outra mesa com o mesmo número.
- **Excluir** (ícone lixeira): só permite se a mesa NÃO tiver reuniões com `status='scheduled'`. Se tiver, mostra erro listando quantas e pedindo para cancelar/remanejar antes. Ao excluir, remove os `time_slots` da mesa também.
- Botão **Reconstruir slots** (já existe) continua funcionando — recomendado depois de criar mesas novas.

### Detalhes técnicos

**Server functions novas em `src/lib/admin.functions.ts`** (todas com `assertAdmin` + `supabaseAdmin`):

- `getCompanyForEdit({ companyId })` — devolve `company`, `ownerProfile`, `visitorProfile`, `exhibitorProfile`, role da empresa.
- `updateCompanyFull({ companyId, company, profile, visitor?, exhibitor? })` — Zod valida cada bloco e faz update nas 4 tabelas em paralelo. Faz upsert em `visitor_profiles`/`exhibitor_profiles` se ainda não existir linha.
- `listAdminCompanies({ search, role, page })` — lê de `v_company_event_pipeline` (já existe) para reaproveitar filtros e paginação.
- `createEventTable({ eventId, tableNumber? })` — calcula próximo número se omitido; valida unicidade.
- `updateEventTable({ tableId, tableNumber })` — renumera; valida unicidade.
- `deleteEventTable({ tableId })` — checa `meetings` com `status='scheduled'`; se houver, lança erro com a contagem. Senão, apaga `time_slots` da mesa e em seguida a mesa.

**UI novas:**

- `src/components/admin/companies/companies-tab.tsx` — lista + filtros + botão Editar.
- `src/components/admin/companies/edit-company-drawer.tsx` — Sheet com `Tabs` (Empresa / Contato / Visitante|Expositor) e `react-hook-form` + zod.
- Pequenas adições inline em `TablesTab` do `admin.tsx`: botão "+ Nova mesa", ícones de editar/excluir por linha, AlertDialog de confirmação.

**Permissões:** todas as ações exigem papel `admin` ou `staff` (igual aos demais admin fns). Toda escrita gera linha em `audit_logs` via os triggers já existentes em `companies`, `profiles` e `user_roles`; vou adicionar `log_audit` manual nas operações de mesa.

**i18n:** novas chaves em `src/lib/i18n/pt-BR.json` (e `es.json`) para os rótulos da aba Empresas e ações de mesa.

### Fora do escopo

- Edição em massa / import CSV.
- Cancelamento automático de reuniões ao excluir mesa (você optou por bloquear).
- Mudar o evento de uma mesa (mesa nasce vinculada ao evento ativo).
