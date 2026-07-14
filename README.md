# Cronômetro — Vida e Ministério Cristão

Projeto recriado do zero em **HTML, CSS e JavaScript puros**. Não usa Vite, npm, build ou GitHub Actions.

## Estrutura

```text
index.html
style.css
script.js
presentation.html
presentation.js
config.js
manifest.webmanifest
sw.js
vercel.json
.nojekyll
icons/icon.svg
supabase/schema.sql
```

## Publicar no GitHub Pages

1. Exclua o conteúdo antigo do repositório.
2. Envie **todos os arquivos e pastas deste projeto para a raiz** do repositório.
3. Confirme que `index.html`, `style.css` e `script.js` aparecem diretamente na raiz.
4. Abra **Settings → Pages**.
5. Em **Source**, selecione **Deploy from a branch**.
6. Escolha a branch `main` e a pasta `/ (root)`.
7. Salve e aguarde a publicação.

Não selecione GitHub Actions. Este projeto não precisa de compilação.

O HTML usa caminhos relativos:

```html
<link rel="stylesheet" href="./style.css">
<script defer src="./script.js"></script>
```

Por isso funciona tanto na raiz quanto em um endereço como:

```text
https://usuario.github.io/cronometro_reuniao/
```

## Publicar na Vercel

1. Importe o mesmo repositório.
2. Selecione **Other** como framework, caso seja solicitado.
3. Deixe Build Command vazio.
4. Deixe Output Directory vazio.
5. Publique.

## Configurar Supabase

O Supabase é opcional. Sem ele, o sistema continua salvando no dispositivo e sincronizando a tela de apresentação entre abas do mesmo navegador.

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e execute `supabase/schema.sql`.
3. Em Authentication, habilite login por e-mail/Magic Link.
4. Edite `config.js`:

```js
window.CRONOMETRO_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'SUA_CHAVE_PUBLISHABLE_OU_ANON'
};
```

A chave publishable/anon é pública por definição. A proteção dos dados depende das políticas RLS incluídas no SQL. **Nunca use a chave `service_role` no navegador.**

5. Em Authentication → URL Configuration, adicione os endereços do GitHub Pages e da Vercel em Redirect URLs.

## Recursos

- Cronômetro baseado em `Date.now()`, resistente a atrasos de `setInterval`.
- Tempo excedido após zero.
- Progresso individual preservado ao navegar.
- Salvamento local automático.
- Recuperação após atualizar ou fechar a página.
- Cronômetro de conselho independente.
- Contador de comentários.
- Editor com cancelamento antes de salvar.
- Importação de texto da apostila.
- PDF, CSV e JSON.
- Histórico local.
- PWA e funcionamento offline após o primeiro acesso.
- Wake Lock para manter a tela ligada.
- Tela de apresentação em `presentation.html`.
- Sincronização local por BroadcastChannel/localStorage.
- Login, backup e apresentação online opcionais com Supabase.

## Limpar uma versão antiga do site

Após substituir um projeto antigo que tinha service worker:

1. Abra o site.
2. Pressione `Ctrl + Shift + R` ou `Ctrl + F5`.
3. Se necessário, abra as ferramentas do navegador → Application → Service Workers → Unregister.
4. Limpe os dados do site uma única vez.

O novo service worker usa o cache `cronometro-reuniao-v1`. Você também pode abrir `reset-cache.html` no endereço publicado e clicar em **Limpar cache e atualizar**.
