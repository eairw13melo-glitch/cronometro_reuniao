# Cronômetro Vida e Ministério — versão 5

Aplicativo estático em HTML, CSS e JavaScript, preparado para GitHub Pages, uso offline e sincronização opcional com Supabase.

## Principais recursos

- cronômetro individual para cada parte e relógio geral da reunião;
- data e horário programados, com registro correto do início real;
- alertas sonoros, vibração, comentários e cronômetro de conselho;
- importação da programação por HTML, HTM ou texto;
- relatórios em PDF, CSV e JSON;
- finalização que interrompe todos os cronômetros e arquiva a reunião;
- histórico local de até 30 reuniões;
- sincronização da reunião e do histórico entre dispositivos pelo Supabase;
- apresentação pública em tempo real, com opção de ocultar nomes dos oradores;
- funcionamento offline após o primeiro carregamento completo;
- instalação como aplicativo PWA em navegadores compatíveis;
- download e restauração de backup completo.

## Backup completo

Na área de relatórios existem dois comandos:

- **Baixar backup:** gera um arquivo JSON com a reunião atual, preferências, tempos e todo o histórico.
- **Restaurar backup:** valida o arquivo, mostra um resumo e pede confirmação antes de substituir os dados atuais.

Os cronômetros são congelados dentro do arquivo de backup. Assim, um cronômetro que estava em execução não acumula horas ou dias quando o backup é restaurado posteriormente.

A restauração também aceita:

- backups completos da versão 5;
- arquivos gerados pelo antigo botão de exportação JSON;
- estados legados que contenham `parts` e `timers`.

O limite aceito para upload é de 10 MB.

## Funcionamento offline

O arquivo `sw.js` mantém em cache os arquivos essenciais do aplicativo. Para preparar o uso offline:

1. acesse o site com internet;
2. aguarde o carregamento completo da página;
3. abra também a tela de apresentação, caso pretenda usá-la offline;
4. depois disso, os recursos principais continuam disponíveis sem conexão.

A sincronização do Supabase e a primeira geração de PDF ainda dependem de internet caso as bibliotecas externas não tenham sido armazenadas anteriormente.

## 1. Criar a estrutura no Supabase

1. Abra o projeto no Supabase.
2. Entre em **SQL Editor**.
3. Crie uma nova consulta.
4. Cole todo o conteúdo de `schema.sql`.
5. Clique em **Run**.

O script é idempotente e pode ser executado novamente em uma instalação existente. Nesta versão, ele também cria a tabela `meeting_archives`, necessária para sincronizar o histórico.

## 2. Configurar o site

Abra `config.js` e preencha:

```js
window.CRONOMETRO_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'SUA_CHAVE_PUBLICA'
};
```

Use somente a chave **Publishable** ou a chave **anon**. Nunca coloque a chave `service_role` no GitHub.

Sem essa configuração, o cronômetro, o histórico e o backup continuam funcionando localmente.

## 3. Autorizar o endereço do GitHub Pages

No Supabase, abra **Authentication > URL Configuration**.

Cadastre como Site URL o endereço do projeto, por exemplo:

```text
https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/
```

Adicione também em Redirect URLs:

```text
https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/
https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/index.html
```

## 4. Publicar no GitHub Pages

Envie todos estes arquivos para a raiz do repositório:

- `.nojekyll`
- `index.html`
- `styles.css`
- `app.js`
- `presentation.html`
- `config.js`
- `schema.sql`
- `manifest.webmanifest`
- `sw.js`
- `icon.svg`
- `icon-192.png`
- `icon-512.png`

Depois:

1. abra **Settings > Pages** no GitHub;
2. em **Build and deployment**, escolha **Deploy from a branch**;
3. selecione a branch `main` e a pasta `/ (root)`;
4. salve.

Ao publicar uma atualização, o service worker substitui automaticamente o cache antigo pela versão nova.

## 5. Usar a nuvem e a apresentação

1. Abra o cronômetro publicado.
2. Clique em **Nuvem**.
3. Digite seu e-mail e abra o link de acesso recebido.
4. Clique em **Criar reunião online**.
5. Clique em **Copiar link da apresentação**.
6. Abra o link no computador, TV, celular ou projetor.

O estado completo fica protegido por Row Level Security. A tela pública recebe somente os dados necessários à apresentação. Em **Preferências**, desmarque **Exibir o nome do orador na apresentação pública** para ocultar os nomes.

O histórico é sincronizado em uma tabela separada, evitando aumentar o registro da reunião ativa. O botão **Reset total** mantém o vínculo com a reunião online e não volta a carregar dados antigos.

## Estrutura do projeto

- `index.html`: estrutura da interface principal;
- `styles.css`: estilos da interface principal;
- `app.js`: lógica do cronômetro, backup, histórico e nuvem;
- `presentation.html`: tela pública em tempo real;
- `config.js`: URL e chave pública do Supabase;
- `schema.sql`: tabela, políticas RLS, função pública e Realtime;
- `manifest.webmanifest`: configuração de instalação PWA;
- `sw.js`: cache e funcionamento offline;
- `icon.svg`, `icon-192.png` e `icon-512.png`: ícones do aplicativo.

## Compatibilidade com dados anteriores

A chave de armazenamento local da versão anterior foi mantida. Ao abrir esta versão, os dados existentes são normalizados automaticamente e recebem os novos campos de data, encerramento e privacidade sem apagar a programação ou os tempos salvos.
