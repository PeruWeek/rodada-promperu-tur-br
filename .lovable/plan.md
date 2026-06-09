## Objetivo

Entregar um **documento Word (.docx)** com checklists operacionais de teste para a equipe validar, no ambiente real, as três jornadas críticas da rodada:

1. **Cadastro de Expositor**
2. **Cadastro de Visitante**
3. **Agendamento de reuniões**

Formato: **checklist com caixa de marcar (ok / não ok / observação)**, linguagem operacional de evento (não técnica), **PT-BR e ES lado a lado** em cada item para o mesmo testador poder rodar nos dois idiomas.

Skill usada para estruturar: `rodada-b2b-eventos` (referências de smoke test, validação de agendamento e modelos de entregáveis).

---

## Estrutura do documento

Capa + 1 seção por jornada. Cada seção segue o mesmo gabarito:

```text
[JORNADA X — NOME]
Pré-requisitos do teste (conta, idioma, dispositivo, dados de exemplo)
Fluxo feliz — passos numerados, cada um com:
   ( ) PT: descrição curta do passo + critério de sucesso
   ( ) ES: mesma descrição em espanhol
   Observação: ____________________________________
Cenários de erro — mesma estrutura, um bloco por cenário
Critério de aprovação da jornada (todos os itens ok)
```

Cada passo cabe em ~1 linha. Sem prosa, sem screenshots, sem jargão técnico.

---

## Conteúdo por jornada

### 1. Cadastro de Expositor
- **Pré-requisitos**: navegador limpo, e-mail novo, idioma do navegador, link de signup do evento.
- **Fluxo feliz**: abrir signup → escolher "Expositor" → preencher dados da empresa → confirmar e-mail → completar onboarding (logo, especialidade, perfil de importação) → ver status "Aguardando aprovação / Aprovado" → acessar painel.
- **Cenários de erro**: e-mail já cadastrado, CNPJ/Tax ID inválido, campo obrigatório vazio, upload de logo > limite, recusar termos, fechar navegador no meio do onboarding (retomar de onde parou), trocar idioma no meio do fluxo.

### 2. Cadastro de Visitante
- **Pré-requisitos**: navegador limpo, e-mail novo OU e-mail pré-cadastrado pelo staff (testar os dois caminhos).
- **Fluxo feliz (auto-cadastro)**: signup → escolher "Visitante/Comprador" → dados pessoais + empresa → confirmar e-mail → onboarding (interesses, idiomas) → aparece em **Explorar**.
- **Fluxo feliz (pré-cadastro via lista importada)**: receber e-mail com link → clicar → dados já vêm preenchidos → criar senha → confirmar → aparece como **Inscrito Confirmado** (não mais como "Pré-cadastro").
- **Cenários de erro**: link expirado, e-mail já confirmado, dados pré-preenchidos editados, recusar idioma, perfil incompleto bloqueia acesso à agenda.

### 3. Agendamento
- **Pré-requisitos**: 1 conta visitante confirmada + 1 conta expositor aprovado + evento ativo com slots configurados.
- **Fluxo feliz**: visitante abre **Explorar** → filtra por especialidade/país → abre ficha do expositor → clica "Agendar" → escolhe slot livre → confirma → reunião aparece em **Minha Agenda** dos dois lados → ambos recebem e-mail de confirmação.
- **Cenários de erro**: slot ocupado entre carregamento e clique, conflito com outra reunião do visitante, expositor sem slots disponíveis, cancelar (libera o slot), reagendar (libera antigo + ocupa novo), atingir limite de reuniões, no-show registrado pelo staff, tentar agendar fora da janela do evento, agenda em PT vs ES (datas/horários localizados).

---

## Detalhes técnicos da geração

- Gerar via `docx` (npm), seguindo a skill `docx`:
  - US Letter, margens 1", Arial 11pt, headings 1/2 customizados.
  - Tabela de 4 colunas por passo: `[ ]` · **PT-BR** · **ES** · **Observação**.
  - Cell width fixa em DXA, `ShadingType.CLEAR` no cabeçalho de cada jornada.
  - Page break entre as 3 jornadas + capa.
- Salvar em `/mnt/documents/checklist-teste-rodada.docx` e emitir `<presentation-artifact>`.
- Validar (`validate_document.py`) e converter para imagens (`run_libreoffice.py` + `pdftoppm`) para QA visual de **todas** as páginas antes de entregar.

---

## Fora do escopo

- Não é manual do usuário final (é doc de QA).
- Não inclui screenshots (mantém leve e imprimível).
- Não documenta painéis de admin/staff (foco em expositor + visitante + agendamento, conforme pedido).
- Não altera código do app.

Se aprovar, gero o .docx e devolvo o link de download.