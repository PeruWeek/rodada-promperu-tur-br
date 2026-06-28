## Instalar Microsoft Clarity

Adicionar o script de tracking do Microsoft Clarity (project ID `xe9u3g88qj`) no shell raiz da aplicação para capturar sessões, cliques e comportamento dos usuários em todas as páginas (cadastro, agendamento, etc.).

### Alteração

**`src/routes/__root.tsx`** — dentro de `RootShell`, no `<body>`, adicionar uma nova tag `<script dangerouslySetInnerHTML>` com o snippet do Clarity, ao lado do script já existente do Mautic (logo antes de `<Scripts />`). Isso garante carregamento em SSR e em todas as rotas, sem depender de hooks de cliente.

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "xe9u3g88qj");`,
  }}
/>
```

### Validação

Após publicar, abrir o site e verificar no DevTools → Network o request para `clarity.ms/tag/xe9u3g88qj`. Os dados aparecem no painel do Clarity em ~2 horas.

### Observação

O Clarity grava sessões e pode capturar conteúdo de formulários. Como o projeto trata dados pessoais de inscritos (LGPD), recomendo no painel do Clarity ativar **Mask sensitive content** para inputs do cadastro. Posso aplicar `data-clarity-mask="true"` em campos sensíveis (CNPJ, e-mail, telefone) se quiser — me avise.
