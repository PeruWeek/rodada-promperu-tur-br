## Objetivo
Transformar `/signup` num wizard multi-step para o **Buyer (Brasil)**, cobrindo as Seções A–E do briefing 4.2, com máscaras e validação automáticas para telefone/WhatsApp/CNPJ, criando os campos que ainda não existem no banco.

## Schema — campos novos (migration)

**`companies`** (adicionar)
- `tax_id text` (CNPJ — opcional, validado quando preenchido)
- `state_code text` (UF — obrigatório p/ Brasil)

**`profiles`** (adicionar)
- `job_title text` (cargo)
- `phone text` (formato E.164)
- `whatsapp text` (E.164; pode ser igual ao phone)

**`visitor_profiles`** (adicionar)
- `demand_profile text` (campo livre)
- `interests_destinations_free text` (destinos extras digitados)
- `consent_data_sharing boolean not null default false`
- `consent_data_sharing_at timestamptz`
- `consent_marketing boolean not null default false`

Atualizar a função `onboard_company` para receber `p_tax_id`, `p_state_code`, e popular esses campos. Adicionar uma RPC `complete_buyer_signup` (security definer) que recebe tudo em um único call e cria/atualiza profile + company + visitor_profile + grava consentimento, ou — mais simples — executar as 3 chamadas (`onboard_company`, `update profile`, `upsert visitor_profile`) numa transação no client após o signup. Vou usar uma RPC única para garantir atomicidade.

## Wizard `/signup` (5 passos)

```text
Passo 1 — Conta              Passo 2 — Empresa          Passo 3 — Contato
  Email                        País (Brasil, fixo)        Nome completo
  Senha                        CNPJ (opcional, máscara)   Cargo
  Confirmar senha              Razão social (opc.)        E-mail (prefill)
                               Nome fantasia *            Telefone *
                               Cidade *                   WhatsApp *
                               UF *                       Idioma (PT/ES)
                               Site (opc.)
                               Instagram (opc.)
                               LinkedIn (opc.)

Passo 4 — Perfil comprador            Passo 5 — Portfólio & Consentimentos
  Tipo de buyer * (select)              Portfólio PT (textarea)
  Segmentos (chips multi)               Portfólio ES (textarea)
  Destinos (chips multi)                Observações (textarea curta)
  Destinos extras (texto livre)         [ ] Consentimento compartilhamento *
  Serviços (chips multi)                [ ] Opt-in comunicações
  Perfil de demanda (textarea)          [Finalizar cadastro]
```

Barra de progresso no topo (1/5 … 5/5), botões "Voltar / Continuar", validação por passo antes de avançar.

## Máscaras e validação (client + server)

- **CNPJ**: máscara `00.000.000/0000-00`, validação de dígitos verificadores (algoritmo padrão). Opcional, mas se preenchido tem que ser válido.
- **Telefone / WhatsApp BR**: máscara dinâmica `(00) 0000-0000` / `(00) 00000-0000`. Armazenar em E.164 (`+5511999998888`). Validação: DDD válido + 10/11 dígitos.
- **Placeholders**: `(11) 91234-5678` para celular/WhatsApp e `(11) 3456-7890` para fixo.
- **UF**: select com as 27 unidades federativas.
- **Email**: HTML5 + zod.
- **Senha**: mínimo 8, com mensagem de erro localizada.

Validação centralizada com **zod** (schema por passo). Erros mostrados inline em vermelho sob cada campo.

## Fluxo de submit

1. Passos 1–5 validados localmente.
2. No "Finalizar": `supabase.auth.signUp({ email, password, options: { data: { full_name, preferred_language } } })`.
3. Tela de "Confirme seu e-mail" (igual à atual), guardando o restante dos dados em `sessionStorage`.
4. Após confirmação e login, `/onboarding` detecta dados pendentes em `sessionStorage` e chama a nova RPC `complete_buyer_signup(payload jsonb)` que faz tudo de uma vez; em seguida redireciona para `/dashboard`.
   - Alternativa simpler: deixar o passo 1 só com email/senha/nome e mover passos 2–5 para dentro de `/onboarding` (mesmo wizard). **Recomendo esta** — evita perder dados se o usuário trocar de dispositivo entre confirmar email e logar. Confirma comigo se preferir manter tudo em `/signup`.

## Arquivos

**Novos**
- `supabase/migrations/<ts>_buyer_signup_fields.sql` — colunas + RPC atualizada.
- `src/lib/validation/br-masks.ts` — utils CNPJ, telefone, formatação E.164.
- `src/lib/validation/buyer-signup.schema.ts` — schemas zod por passo.
- `src/components/signup-wizard/` — `Stepper.tsx`, `StepAccount.tsx`, `StepCompany.tsx`, `StepContact.tsx`, `StepBuyerProfile.tsx`, `StepPortfolioConsent.tsx`.
- `src/components/ui/masked-input.tsx` — Input que recebe máscara.

**Editados**
- `src/routes/signup.tsx` — substitui formulário atual pelo wizard.
- `src/routes/onboarding.tsx` — passa a apenas finalizar (chama RPC) se vier do novo fluxo.
- `src/lib/i18n/pt-BR.json` + `es.json` — labels, placeholders, mensagens de erro, taxonomia de buyer.
- `src/lib/taxonomy.ts` — já cobre buyer_types/segments/services/destinations.

## Dependências

- `bun add zod` (já está no projeto? verificar; se não, adicionar)
- Sem libs de máscara externas — implemento puro em ~40 linhas para CNPJ/telefone (evita peso desnecessário).

## Pontos a confirmar

1. Manter wizard inteiro em `/signup` (dados em sessionStorage até confirmar email) OU dividir: conta em `/signup`, restante em `/onboarding`? Recomendo a segunda — mais robusto.
2. "Idioma preferido" no passo 3 sobrescreve o idioma atual da UI ao salvar?
3. O CNPJ deve ser **único** por empresa (índice unique) ou pode repetir?
