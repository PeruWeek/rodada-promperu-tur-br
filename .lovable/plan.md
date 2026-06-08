## Validação
Faz sentido o seu apontamento. O fluxo "Explorar expositores" foi desenhado para o visitante/comprador encontrar operadores peruanos e agendar reuniões. Para um expositor, navegar nessa mesma lista não tem propósito funcional:

- ele não agenda reuniões com outros expositores (o botão de agendamento é para visitantes);
- a página mostra "operadores peruanos por segmento/serviço/destino", que é exatamente o que o próprio expositor é;
- o painel do expositor deve focar em "Agenda da Mesa" (reuniões que visitantes marcaram com ele).

Sobre "Explorar empresa": não há hoje um catálogo separado de empresas compradoras/visitantes para o expositor explorar — a única lista pública existente é a de expositores. Portanto a recomendação é **remover** o acesso, não renomear. Caso no futuro queira oferecer ao expositor a lista de visitantes/compradores inscritos, isso seria uma nova tela.

## Alterações
1. `src/components/site-header.tsx`: no array `navItems` do expositor, remover o item `/explore` (manter Painel, Agenda da Mesa, Perfil).
2. `src/routes/_authenticated.tsx`: incluir `/explore` na lista de rotas proibidas para `primaryRole === "exhibitor"` (redireciona para `/dashboard` se o expositor tentar acessar pela URL).
3. `src/routes/_authenticated/dashboard.tsx`: no card "Próxima reunião", esconder o botão "Explorar expositores" quando o usuário for expositor (ele continua aparecendo para visitantes). Para expositor, o card fica só com o texto "Você ainda não tem reuniões agendadas." — sem CTA, já que o agendamento parte do visitante.

## Resultado
- Expositor não vê mais "Explorar" no menu nem o botão "Explorar expositores" no painel.
- Se acessar `/explore` diretamente, é redirecionado para `/dashboard`.
- Visitantes continuam com a experiência atual de explorar expositores.
