UPDATE public.email_template_overrides
SET
  intro_pt = CASE
    WHEN coalesce(intro_pt, '') ~* '(não informar agora|nao informar agora)'
      THEN 'Obrigado por participar da Rodada de Negócios. Para fecharmos o relatório do evento, confirme abaixo com quais empresas você realmente se reuniu e responda 3 perguntas rápidas sobre o evento.'
    ELSE intro_pt
  END,
  outro_pt = CASE
    WHEN coalesce(outro_pt, '') ~* '(não informar agora|nao informar agora)'
      THEN 'Leva menos de 2 minutos. Sua resposta é essencial para melhorarmos a próxima edição.'
    ELSE outro_pt
  END,
  cta_label_pt = CASE
    WHEN coalesce(cta_label_pt, '') ~* '(não informar agora|nao informar agora)'
      THEN 'Confirmar minhas reuniões'
    ELSE cta_label_pt
  END,
  intro_es = CASE
    WHEN coalesce(intro_es, '') ~* '(no informar ahora|não informar agora|nao informar agora)'
      THEN 'Gracias por participar de la Rueda de Negocios. Para cerrar el reporte del evento, confirma abajo con qué empresas realmente te reuniste y responde 3 preguntas rápidas sobre el evento.'
    ELSE intro_es
  END,
  outro_es = CASE
    WHEN coalesce(outro_es, '') ~* '(no informar ahora|não informar agora|nao informar agora)'
      THEN 'Menos de 2 minutos. Tu respuesta es esencial para mejorar la próxima edición.'
    ELSE outro_es
  END,
  cta_label_es = CASE
    WHEN coalesce(cta_label_es, '') ~* '(no informar ahora|não informar agora|nao informar agora)'
      THEN 'Confirmar mis reuniones'
    ELSE cta_label_es
  END,
  updated_at = now()
WHERE template_name = 'postevent-qa'
  AND concat_ws(' ', intro_pt, outro_pt, cta_label_pt, intro_es, outro_es, cta_label_es) ~* '(não informar agora|nao informar agora|no informar ahora)';