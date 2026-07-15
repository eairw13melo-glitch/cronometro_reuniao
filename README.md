# Cronômetro Vida e Ministério — versão online

Aplicativo estático em HTML, CSS e JavaScript, preparado para GitHub Pages e Supabase.

## O que esta versão faz

- mantém o cronômetro funcionando localmente mesmo sem login;
- salva a reunião no Supabase;
- restaura a reunião mais recente em outro computador ou celular após o login;
- atualiza a tela de apresentação em tempo real por um link com código;
- sincroniza alterações entre dois controladores autenticados;
- protege o estado completo com Row Level Security (RLS).

## 1. Criar a estrutura no Supabase

1. Abra o projeto no Supabase.
2. Entre em **SQL Editor**.
3. Crie uma nova consulta.
4. Cole todo o conteúdo de `schema.sql`.
5. Clique em **Run**.

## 2. Configurar o site

Abra `config.js` e preencha:

```js
window.CRONOMETRO_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'SUA_CHAVE_PUBLICA'
};
```

Use somente a chave **Publishable** ou a chave **anon**. Nunca coloque a `service_role` no GitHub.

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

1. Envie estes arquivos para a raiz do repositório.
2. No GitHub, abra **Settings > Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Selecione a branch `main` e a pasta `/ (root)`.
5. Salve.

## 5. Usar

1. Abra o cronômetro publicado.
2. Clique em **Nuvem**.
3. Digite seu e-mail e abra o link de acesso recebido.
4. Clique em **Criar reunião online**.
5. Clique em **Copiar link da apresentação**.
6. Abra esse link no computador, TV, celular ou projetor que exibirá o tempo.

A tela de apresentação recebe as mudanças imediatamente. Se a conexão Realtime cair, ela também consulta o banco periodicamente para se recuperar.

## Arquivos principais

- `index.html`: controlador do cronômetro;
- `presentation.html`: tela pública em tempo real;
- `config.js`: URL e chave pública do Supabase;
- `schema.sql`: tabela, políticas RLS, função pública e configuração Realtime.
