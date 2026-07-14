# Cronômetro — Nossa Vida e Ministério Cristão V2

Versão em HTML, CSS e JavaScript modular usando Vite. O layout principal foi preservado; as mudanças são de confiabilidade, persistência, segurança e publicação.

## O que foi implementado

- Cronômetro baseado em `Date.now()`, resistente a abas em segundo plano e suspensão do dispositivo.
- Tempo excedido por parte e por conselho, exibido como `+00:01`.
- Progresso individual preservado ao avançar ou voltar.
- Salvamento automático no `localStorage`, inclusive com cronômetro em execução.
- Histórico local das últimas 30 reuniões.
- Editor com cópia temporária, cancelamento, confirmação de remoção e validação de links.
- Alertas em 60 segundos, 30 segundos e no término; som e vibração configuráveis.
- Apenas um cronômetro de conselho ativo por vez.
- Screen Wake Lock automático durante cronômetros.
- PWA instalável e funcionamento offline após o primeiro carregamento.
- PDF, CSV e JSON.
- Tela de apresentação em `presentation.html`.
- Sincronização local entre abas por BroadcastChannel.
- Supabase opcional: login por link mágico, histórico online e apresentação em tempo real por código.
- Row Level Security e SQL completo em `supabase/schema.sql`.
- Cabeçalhos de segurança para Vercel.
- Testes automatizados e GitHub Actions.

## Executar no computador

Requer Node.js 20.19 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite.

## Verificar antes de publicar

```bash
npm test
npm run build
npm run preview
```

## Publicar no GitHub

```bash
git init
git add .
git commit -m "Cronômetro Vida e Ministério V2"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

Não envie o arquivo `.env` para o GitHub. Ele já está no `.gitignore`.

## Publicar na Vercel

1. Entre na Vercel e escolha **Add New > Project**.
2. Importe o repositório do GitHub.
3. A Vercel deve detectar **Vite** automaticamente.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Publique.

Sem Supabase, o aplicativo já funciona localmente e offline.

## Configurar Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Execute todo o arquivo `supabase/schema.sql`.
4. Em **Authentication > URL Configuration**, configure:
   - Site URL: endereço de produção da Vercel.
   - Redirect URLs: endereço da Vercel e endereços de preview necessários.
5. Copie a URL do projeto e a chave pública/publishable.
6. Crie um arquivo `.env` local a partir do exemplo:

```bash
cp .env.example .env
```

7. Preencha:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICA
```

8. Na Vercel, abra **Settings > Environment Variables** e cadastre as mesmas duas variáveis.

A chave `service_role` nunca deve ser usada no frontend, no GitHub ou nas variáveis públicas da Vercel.

## Modo apresentação

- Sem Supabase: clique em **Modo apresentação** e mantenha as duas abas no mesmo navegador/dispositivo. A sincronização usa BroadcastChannel e armazenamento local.
- Com Supabase e login: a apresentação abre com um código compartilhável e recebe atualizações em tempo real em outro dispositivo.

## Estrutura

```text
index.html
presentation.html
src/
  main.js
  presentation.js
  styles.css
  core/
  services/
public/
  manifest.webmanifest
  service-worker.js
  icons/
supabase/
  schema.sql
tests/
vercel.json
vite.config.js
```
