## Objetivo
Incluir na página principal (`src/routes/index.tsx`) duas novas seções com as informações da peça enviada:

1. **Local / Endereço**
   - Restaurante AMAZO Cozinha Peruana
   - Rua Guaianases, 1149 – Campos Elíseos
   - Quarta-feira, 08 de julho de 2026

2. **Programação**
   - 08:00 – 09:00 — Registro de participantes
   - 09:00 – 14:15 — Rodada de Negócios
   - 14:15 – 17:00 — Almoço e Networking

## Implementação

- Editar apenas `src/routes/index.tsx` para adicionar duas novas seções entre "Como funciona" e o footer:
  - **Programação**: lista vertical com horário + atividade, ícone `Clock` do lucide-react, cards usando os tokens de design existentes (`border-border`, `bg-card`, `text-muted-foreground`).
  - **Local**: card com ícones `MapPin` e `Calendar`, mostrando nome do restaurante, endereço e data.
- Adicionar as traduções correspondentes em `src/lib/i18n/pt-BR.json` e `src/lib/i18n/es.json` sob novas chaves `landing.scheduleTitle`, `landing.scheduleItems`, `landing.venueTitle`, `landing.venueName`, `landing.venueAddress`, `landing.venueDate`.
- Manter a estética atual (mesma grid, mesmos tokens, sem cores hardcoded). Sem alteração de lógica de negócio.

## Arquivos
- `src/routes/index.tsx` (edit)
- `src/lib/i18n/pt-BR.json` (edit)
- `src/lib/i18n/es.json` (edit)
