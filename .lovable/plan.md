## Substituir o quadrado vermelho pelo logo PromPerú e atualizar o favicon

### Passos

1. Copiar a imagem enviada (`download.png`) para `src/assets/promperu-logo.png` (para o header) e `public/favicon.png` (para o favicon).
2. Em `src/components/site-header.tsx`:
   - Importar `promperuLogo from "@/assets/promperu-logo.png"`.
   - Substituir o `<span className="... bg-primary" />` (quadrado vermelho) por `<img src={promperuLogo} alt="PromPerú" className="h-8 w-8 rounded-sm object-contain" />`.
3. Em `src/routes/__root.tsx`:
   - Adicionar `{ rel: "icon", type: "image/png", href: "/favicon.png" }` ao array `links` do `head()`.

Nenhuma outra mudança visual ou de comportamento.