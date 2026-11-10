# Adega011 · São Paulo no copo

Loja virtual / cardápio digital da **Adega011**: o cliente monta o pedido pelo celular e envia pronto pelo **WhatsApp**. O dono gerencia tudo em um painel em `/admin`.

<p>
  <img src="docs/telas/vitrine.png" width="200" alt="Vitrine no celular">
  <img src="docs/telas/carrinho.png" width="200" alt="Carrinho em bottom sheet">
  <img src="docs/telas/checkout.png" width="200" alt="Checkout com validação">
  <img src="docs/telas/admin-pedidos.png" width="200" alt="Painel de pedidos">
</p>

## O que tem

**Loja (cliente)**
- Banner editável. Quando não há imagem, usa o grafismo de linhas de rua da marca.
- Barra de categorias fixa, com rolagem horizontal, e busca que ignora acentos.
- Cards com foto grande (lazy loading), selos **Destaque** e **Esgotado**, e contador +/−.
- Carrinho em gaveta lateral (desktop) ou *bottom sheet* (celular), com botão flutuante mostrando quantidade e total.
- Checkout em uma tela: nome, telefone, entrega ou retirada, região com taxa automática, endereço, pagamento (Pix, cartão na entrega, dinheiro com troco) e observações.
- Validação de pedido mínimo e de campos obrigatórios. O pedido é registrado no banco e depois o `wa.me` abre com a mensagem formatada.
- Aviso de aberto/fechado pelo horário de São Paulo, inclusive para expediente que passa da meia-noite, com opção de abrir/fechar manualmente.
- Verificação de idade (+18), SEO (meta tags, Open Graph, sitemap, JSON-LD `LiquorStore`) e PWA instalável com página offline.

**Painel (`/admin`)**
- Login com e-mail e senha, só para o dono, com **“Esqueci minha senha”** (link por e-mail).
- **Pedidos** em tempo real, com aviso sonoro, status (novo → confirmado → saiu para entrega → concluído/cancelado) e atalho para o WhatsApp do cliente.
- **Produtos**: criar, editar e excluir, upload de foto (reduzida para WebP no próprio celular), destaque, esgotado, visível e ordem por arrastar. Fotos trocadas, descartadas ou de produtos excluídos são apagadas do Storage.
- **Categorias**: criar, renomear, ocultar e reordenar arrastando (mouse, toque ou teclado).
- **Banner**: título, texto, botão, link e imagem, com pré-visualização.
- **Entrega**: regiões com taxa, pedido mínimo, tempo de entrega e liga/desliga de entrega e retirada.
- **Loja**: nome, WhatsApp, endereço, Instagram, chave Pix, formas de pagamento, horários e abrir/fechar manual.

## Stack

| | |
|---|---|
| **Next.js 16** (App Router, Cache Components) + **TypeScript** | A vitrine é pré-renderizada e fica em cache. Quando você salva algo no painel, a loja é atualizada na hora. |
| **Tailwind CSS v4** + componentes no padrão **shadcn/ui** (Radix) | Acessíveis e com a identidade da marca |
| **Supabase** (Postgres, Auth, Storage, Realtime) | Banco com RLS, login do admin, fotos e pedidos em tempo real |
| **Zustand** | Carrinho salvo no navegador |
| **Playwright** + **axe-core** | Testes de ponta a ponta e de acessibilidade |

> **Modo demonstração:** sem as variáveis do Supabase, a loja abre com os dados de exemplo (10 produtos em 4 categorias) e o checkout funciona normalmente. O painel exige o Supabase.

---

## 1. Rodar no seu computador

Pré-requisito: [Node.js](https://nodejs.org) 20.9 ou superior (recomendado 22).

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:3000. Sem `.env.local`, a loja roda em modo demonstração.

## 2. Criar o projeto no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e clique em **New project**. Escolha a região **South America (São Paulo)**.
2. No menu **SQL Editor**, clique em **New query**, cole **todo** o conteúdo de [`supabase/migrations/20261110000000_schema.sql`](supabase/migrations/20261110000000_schema.sql) e clique em **Run**. Esse script cria:
   - as tabelas, as regras de segurança (RLS) e a função que registra pedidos;
   - o bucket de fotos `produtos`;
   - a publicação de pedidos no Realtime.
3. Coloque os dados de exemplo usando **uma** destas opções:
   - no SQL Editor, rode [`supabase/seed.sql`](supabase/seed.sql); **ou**
   - configure o `.env.local` (passo 3) e rode `npm run seed`.
4. Em **Authentication → Sign In / Providers**:
   - deixe **Email** ativado;
   - **desligue “Allow new users to sign up”**, para que ninguém além de você consiga criar conta.

> Os dois scripts podem ser rodados de novo sem problema: o schema usa `if not exists` e o seed faz *upsert*.

## 3. Configurar as variáveis

Copie o arquivo de exemplo:

```bash
cp .env.example .env.local
```

Preencha com os dados de **Project Settings → API Keys** (ou do botão **Connect**):

| Variável | Onde achar | Vai para a Vercel/Netlify? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave **publishable** (`sb_publishable_…`) ou a legada **anon** | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave **secret** (`sb_secret_…`) ou a legada **service_role** | **Não**: só para `npm run seed` e `npm run criar-admin` no seu computador |
| `NEXT_PUBLIC_SITE_URL` | O endereço do site (ex.: `https://adega011.com.br`) | Sim |

> O `.env.local` está no `.gitignore`. **Nunca** faça commit da chave secreta.

## 4. Criar o usuário admin

**Opção A: pelo terminal (recomendado)**

```bash
npm run criar-admin -- voce@adega011.com.br "UmaSenhaForte123"
```

**Opção B: pelo painel do Supabase**

1. Vá em **Authentication → Users → Add user → Create new user**, informe e-mail e senha e marque **Auto Confirm User**.
2. No **SQL Editor**, rode:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'voce@adega011.com.br';
   ```

Depois é só entrar em `/admin/login`. Se esquecer a senha, use **“Esqueci minha senha”** na tela de login: o link chega por e-mail e deve ser aberto no mesmo navegador em que foi pedido.

> O e-mail padrão do Supabase tem limite baixo de envios por hora. Para produção, configure um SMTP próprio em **Authentication → Emails → SMTP Settings** (ex.: Resend, Brevo, Amazon SES). Um usuário que faz login mas não está na tabela `admins` vê “Acesso negado” e não consegue ler nem alterar nada, porque o RLS bloqueia no banco.

## 5. Deploy

### Vercel (recomendado)

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `adega011-loja`. O Framework Preset “Next.js” é detectado sozinho.
2. Em **Environment Variables**, adicione `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_SITE_URL`.
3. Clique em **Deploy**. Para usar seu domínio, configure em **Settings → Domains**.
4. No Supabase, vá em **Authentication → URL Configuration**:
   - **Site URL**: o endereço do site (ex.: `https://adega011.com.br`);
   - **Redirect URLs**: adicione `https://adega011.com.br/admin/auth/confirmar` (e, para testar no computador, `http://localhost:3000/admin/auth/confirmar`). Sem isso, o link de “Esqueci minha senha” não funciona.

### Netlify

1. Em **Add new project → Import an existing project**, escolha o repositório. O `netlify.toml` já está configurado e o Netlify detecta Next.js automaticamente.
2. Em **Site configuration → Environment variables**, adicione as mesmas três variáveis e faça o deploy.

> Sempre que mudar uma variável `NEXT_PUBLIC_*`, faça um novo deploy: elas entram no código no momento do build.

## 6. Personalizar

- **Dados reais da loja** (WhatsApp, endereço, horário, pedido mínimo, regiões e taxas): edite pelo painel em `/admin/loja` e `/admin/entrega`. Os valores iniciais ficam em [`src/lib/dados-exemplo.ts`](src/lib/dados-exemplo.ts). Se mudar esse arquivo, rode `npm run seed:sql` para atualizar o `seed.sql`.
- **Logo**: o selo usado no site é `public/logo-selo.svg`; as variações do kit estão em `public/marca/`. Os ícones do app e o favicon ficam em `public/icons/`, `src/app/icon.svg` e `src/app/apple-icon.png`.
- **Cores e fontes**: em [`src/app/globals.css`](src/app/globals.css) (tokens `--color-*`).
- **Fotos de exemplo**: são ilustrações em `public/produtos/`. Troque pelas fotos reais pelo painel.

## 7. Testes

```bash
npm run lint
```

```bash
npm run typecheck
```

Testes de ponta a ponta em modo demonstração (fluxo de compra, taxa, link do WhatsApp, loja fechada e acessibilidade):

```bash
npm run test:e2e
```

Testes de integração com um Supabase **local**. Precisa do Docker e usa `supabase init` + `supabase start`. Antes de rodar, aponte o `.env.local` para o Supabase local e crie o admin `dono@adega011.test` / `SenhaForte123`, ou passe `ADMIN_EMAIL`/`ADMIN_SENHA`:

```bash
npm run test:e2e:supabase
```

Esses testes cobrem login, recuperação de senha (lendo o e-mail no Mailpit do `supabase start`), pedido em tempo real, edição, upload e limpeza de fotos, reordenação, taxa, banner, loja fechada e RLS. No `supabase/config.toml` local, use `site_url = "http://localhost:3200"` e `additional_redirect_urls = ["http://localhost:3200/**"]`. Eles alteram dados, então use um banco de testes e rode `npx supabase db reset` antes.

## Estrutura

```
src/
  app/
    page.tsx              vitrine
    admin/                login, recuperar/nova senha e painel (pedidos, produtos, categorias, banner, entrega, loja)
    admin/auth/confirmar  recebe o link do e-mail e cria a sessão
    admin/acoes.ts        Server Action que revalida a vitrine (confere se é admin)
    manifest.ts, robots.ts, sitemap.ts, opengraph-image.png
  components/
    loja/                 banner, catálogo, card, carrinho/checkout, idade, rodapé
    admin/                telas e componentes do painel
    marca/                grafismos (linhas de rua, padrão 011) e ícones
    ui/                   botões, campos e gaveta (padrão shadcn/ui)
  lib/
    loja.ts               carrega os dados da vitrine (com cache)
    pedido.ts             totais, validação e mensagem do WhatsApp
    horario.ts            aberto/fechado no fuso de São Paulo
    carrinho.ts           estado do carrinho
  proxy.ts                protege /admin (o antigo middleware)
supabase/
  migrations/             schema + RLS + função criar_pedido + storage
  seed.sql                dados de exemplo (gerado por npm run seed:sql)
scripts/                  seed, criar-admin, gerar seed.sql
tests/                    Playwright (demo e integração com Supabase)
```

## Segurança

- **RLS em todas as tabelas.** O visitante só **lê** o catálogo ativo e as configurações. Só quem está na tabela `admins` escreve.
- **Pedidos** não podem ser lidos nem inseridos diretamente pelo público. Eles passam pela função `criar_pedido()`, que **recalcula** preços, taxa, pedido mínimo e troco no servidor, recusa itens esgotados e limita a 5 pedidos por telefone a cada 10 minutos.
- **Fotos**: o bucket é público para leitura pela URL; só o admin lista, envia, troca ou apaga.
- **Recuperação de senha**: a rota de retorno só redireciona para dentro de `/admin` (sem redirecionamento aberto) e a tela não revela se um e-mail tem conta.
- A atualização da vitrine (`revalidarLoja`) confere a sessão e a permissão de admin no servidor.
