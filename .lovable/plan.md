## Diagnóstico da configuração atual de OG Image

### Onde está definida
A `og:image` está configurada no arquivo **src/routes/__root.tsx**, linha 93.

### URL atual
`https://rodada.promperu.tur.br/og-image.jpg`

### Escopo (global ou homepage)
**Global.** Por estar no `__root.tsx` (layout raiz do TanStack Router), essa configuração aplica-se a todas as rotas do site, a menos que uma rota filha a sobrescreva explicitamente.

---

## Plano de alteração

1. **Copiar a imagem anexada** `whatsapp-og.png` para `public/whatsapp-og.png`, tornando-a acessível publicamente em `https://rodada.promperu.tur.br/whatsapp-og.png`.

2. **Atualizar `src/routes/__root.tsx`**
   - Trocar `og:image` de `https://rodada.promperu.tur.br/og-image.jpg` → `https://rodada.promperu.tur.br/whatsapp-og.png`
   - Trocar `twitter:image` de `https://rodada.promperu.tur.br/og-image.jpg` → `https://rodada.promperu.tur.br/whatsapp-og.png`
   - Manter `og:image:width` = `1200` e `og:image:height` = `630` (já coincidem com as dimensões reais da nova imagem)

3. **Remover ou deprecar** o arquivo antigo `public/og-image.jpg` para evitar confusão futura (opcional, a confirmar).

---

## Nota importante sobre cache de redes sociais
Plataformas como WhatsApp, Facebook, LinkedIn e Twitter cacheiam a imagem de preview. Mesmo após a troca, a imagem antiga pode continuar aparecendo em links compartilhados até que o cache expire ou seja invalidado manualmente via debuggers de cada plataforma (ex: Facebook Sharing Debugger, LinkedIn Post Inspector).