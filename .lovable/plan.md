# Plano: criar skill `rodada-b2b-eventos`

Skill de especialista em produção de rodada de negócios B2B (operação presencial + dinâmica de grupos), conforme briefing fornecido.

## Arquivos a criar

```
.agents/skills/rodada-b2b-eventos/
├── SKILL.md
└── references/
    ├── operacao-presencial.md
    ├── dinamica-grupos.md
    └── modelos-entregaveis.md
```

## Conteúdo de cada arquivo

### SKILL.md
Frontmatter:
- `name: rodada-b2b-eventos`
- `description`: aciona quando o pedido envolver produção/operação presencial de rodada de negócios, runbook, staff plan, dinâmica de grupos, credenciamento, controle de mesas, no-show, ou experiência do participante em eventos B2B.

Corpo:
- **Papel**: especialista produto + produtor(a) de eventos (foco em atrito, fluidez, regras auditáveis, antecipação de falhas).
- **Entregáveis possíveis** (lista do briefing: jornada, runbook, checklists T-30..D+1, staff plan, regras de agendamento, plano de comunicação PT/ES, plano de dados).
- **Perguntas padrão** antes de fechar análise (formato, tempo, check-in, ambiente, no-show, equipe, idiomas).
- **Regras de ouro** (buffer, controle de tempo, sinalização, listas impressas, no-show esperado, timekeeper).
- **Ponteiros para references/** com 1 linha cada explicando quando ler.

### references/operacao-presencial.md
- Credenciamento (fluxo, filas, fallback offline)
- Sinalização e ambiente (mesas numeradas, telão, sonorização)
- Controle de tempo (cronômetro, sinos, MC/timekeeper)
- Contingências: Wi-Fi caindo, QR não lendo, troca de mesa, atrasos em cascata
- Operação de mesas (staff por bloco, rotação, reposição)
- Política de no-show e encaixe/standby
- Dados a registrar no dia (presença, atrasos, resultados, fotos)

### references/dinamica-grupos.md
- Regras de circulação (fluxo livre vs controlado, sentido único, raias)
- Briefing de participantes (expositor / visitante) antes do evento e na abertura
- Etiqueta de reunião 1:1 (abertura, troca de cartão/QR, fechamento)
- Mediação ativa (quando intervir, sinais de mesa "presa")
- Acessibilidade e idiomas (PT/ES, tradução pontual)
- Experiência ponta a ponta: chegada → reuniões → coffee → saída/NPS

### references/modelos-entregaveis.md
Templates prontos em Markdown:
- Run of show (tabela: HH:MM | bloco | dono | ação | contingência)
- Checklists T-30 / T-7 / T-1 / D0 / D+1
- Staff plan (função, qtd, posição, rádio/canal, responsável)
- Regras de agendamento (buffers, travas, critérios de priorização, encaixe)
- Plano de comunicação PT/ES (e-mail pré, WhatsApp D-1, scripts MC no dia)
- Plano de dados (tabela do que registrar, por quem, em qual sistema)
- Mapa de jornada (visitante / expositor / staff) em formato tabela

## Próximo passo após aprovação

No modo build: criar os 4 arquivos em paralelo e aplicar com `skills--apply_draft .agents/skills/rodada-b2b-eventos`.
