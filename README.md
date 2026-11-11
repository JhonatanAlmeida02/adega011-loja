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
- Cards com foto grande (lazy loading), selos **Destaque**, **Esgotado** e **Últimas unidades**, e contador +/−.
- **Adicionais** no produto (como no iFood): ex.: Copão de Askov R$ 10,00 com Baly + R$ 3,00. Grupos com escolha obrigatória ou opcional e limite de opções.
- Carrinho em gaveta lateral (desktop) ou *bottom sheet* (celular), com botão flutuante mostrando quantidade e total.
- Checkout em uma tela: nome, telefone, entrega ou retirada, endereço, pagamento (Pix, cartão na entrega, dinheiro com troco) e observações.
- Taxa de entrega **por km rodado** (taxa inicial + valor por km, distância pela rua via Google Maps) ou **por região**, à escolha no painel.
- Validação de pedido mínimo e de campos obrigatórios. O pedido é registrado no banco e depois o `wa.me` abre com a mensagem formatada.
- Aviso de aberto/fechado pelo horário de São Paulo, inclusive para expediente que passa da meia-noite, com opção de abrir/fechar manualmente.
- Verificação de idade (+18), SEO (meta tags, Open Graph, sitemap, JSON-LD `LiquorStore`) e PWA instalável com página offline.

**Painel (`/admin`)**
- Login com e-mail e senha, só para o dono, com **“Esqueci minha senha”** (link por e-mail).
- **Pedidos** em tempo real, com aviso sonoro, status (novo → confirmado → saiu para entrega → concluído/cancelado), adicionais de cada item e atalho para o WhatsApp do cliente.
- **PDV** (venda no balcão): abrir caixa, vender tocando nos produtos (com adicionais), desconto em R$ ou %, troco calculado, cupom para impressora térmica de 80 mm, sangria/suprimento e fechamento com conferência da gaveta.
- **Estoque**: controle por produto, entrada de mercadoria, ajuste por contagem e histórico. Vendas do site e do balcão baixam sozinhas; cancelar devolve; no zero o produto aparece como esgotado.
- **Relatórios**: faturamento, pedidos, ticket médio, por dia, por forma de pagamento, site × balcão e mais vendidos.
- **Produtos**: criar, editar e excluir, adicionais, controle de estoque, foto por upload (reduzida para WebP no próprio celular) ou **colando o link de uma imagem** (o servidor baixa, reduz e guarda no Storage), destaque, esgotado, visível e ordem por arrastar. Fotos trocadas, descartadas ou de produtos excluídos são apagadas do Storage.
- **Categorias**: criar, renomear, ocultar e reordenar arrastando (mouse, toque ou teclado).
- **Banner**: título, texto, botão, link e imagem, com pré-visualização.
- **Entrega**: frete por km (taxa inicial, valor por km, raio máximo) ou por região, pedido mínimo, tempo de entrega e liga/desliga de entrega e retirada.
- **Loja**: nome, WhatsApp, endereço, Instagram, chave Pix, formas de pagamento, horários e abrir/fechar manual.

## Stack

| | |
|---|---|
| **Next.js 16** (App Router, Cache Components) + **TypeScript** | A vitrine é pré-renderizada e fica em cache. Quando você salva algo no painel, a loja é atualizada na hora. |
| **Tailwind CSS v4** + componentes no padrão **shadcn/ui** (Radix) | Acessíveis e com a identidade da marca |
| **Supabase** (Postgres, Auth, Storage, Realtime, Edge Functions) | Banco com RLS, login do admin, fotos, pedidos em tempo real e cálculo do frete |
| **Google Maps** (Geocoding + Routes) | Distância pela rua para o frete por km |
| **Zustand** | Carrinho salvo no navegador |
| **Playwright** + **axe-core** | Testes de ponta a ponta e de acessibilidade |

> **Modo demonstração:** sem as variáveis do Supabase, a loja abre com os dados de exemplo (produtos em 4 categorias, incluindo um com adicionais) e o checkout funciona normalmente. O painel exige o Supabase.

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
2. No menu **SQL Editor**, rode **em ordem** cada arquivo de [`supabase/migrations/`](supabase/migrations) (cole o conteúdo inteiro e clique em **Run**):
   1. `20261110000000_schema.sql`: tabelas, regras de segurança (RLS), função de pedidos, bucket de fotos e Realtime;
   2. `20261111000100_adicionais_estoque.sql`: adicionais e estoque;
   3. `20261111000200_frete_pedidos_pdv.sql`: frete por km, pedido v2, PDV/caixa e relatórios.
   4. `20261111000300_permissoes_servico.sql`: permissões da função de frete (cotar-frete).

   Com a [CLI do Supabase](https://supabase.com/docs/guides/cli) dá para aplicar tudo com `npx supabase db push`.
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

## 5. Frete por km (Google Maps)

A taxa é **taxa inicial + valor por km rodado** (ex.: R$ 2,00 + R$ 1,50/km), com a distância pela rua da loja até o cliente. Quem calcula é a Edge Function [`cotar-frete`](supabase/functions/cotar-frete/index.ts), que roda no Supabase e grava a cotação no banco. O pedido só aceita a taxa de uma cotação gravada (válida por 45 min e para o mesmo endereço), então ninguém consegue mudar o frete pelo navegador.

1. **Chave do Google**: no [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative as APIs **Geocoding API** e **Routes API**. Em **APIs e serviços → Credenciais**, crie uma **chave de API** e restrinja-a a essas duas APIs. O Google pede um cartão, mas tem cota gratuita mensal que uma adega dificilmente ultrapassa.
2. **Publicar a função** (uma vez):

   ```bash
   npx supabase functions deploy cotar-frete --no-verify-jwt
   ```

3. **Guardar a chave** em **Supabase → Edge Functions → Secrets** com o nome `GOOGLE_MAPS_API_KEY`. A chave fica só no Supabase, nunca no site.
4. No painel, em **Entrega → Como cobrar a entrega**, escolha **Por km rodado** e confira a taxa inicial, o valor por km, o raio máximo e a cidade padrão.

> O endereço da loja (em **Painel → Loja**) é o ponto de partida. Ele é localizado uma vez e guardado; se mudar, é localizado de novo automaticamente.

## 6. Deploy

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

## 7. Personalizar

- **Dados reais da loja** (WhatsApp, endereço, horário, pedido mínimo, regiões e taxas): edite pelo painel em `/admin/loja` e `/admin/entrega`. Os valores iniciais ficam em [`src/lib/dados-exemplo.ts`](src/lib/dados-exemplo.ts). Se mudar esse arquivo, rode `npm run seed:sql` para atualizar o `seed.sql`.
- **Logo**: o selo usado no site é `public/logo-selo.svg`; as variações do kit estão em `public/marca/`. Os ícones do app e o favicon ficam em `public/icons/`, `src/app/icon.svg` e `src/app/apple-icon.png`.
- **Cores e fontes**: em [`src/app/globals.css`](src/app/globals.css) (tokens `--color-*`).
- **Fotos de exemplo**: são ilustrações em `public/produtos/`. Troque pelas fotos reais pelo painel.

## 8. Testes

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

Para o frete, rode também `npx supabase functions serve --env-file supabase/functions/.env` com `MAPS_FAKE=1` nesse arquivo (o modo de teste inventa os km, sem gastar a cota do Google). Esses testes cobrem PDV com caixa, estoque, frete por km, relatórios, login, recuperação de senha (lendo o e-mail no Mailpit do `supabase start`), pedido em tempo real, edição, upload e limpeza de fotos, reordenação, taxa, banner, loja fechada e RLS. No `supabase/config.toml` local, use `site_url = "http://localhost:3200"` e `additional_redirect_urls = ["http://localhost:3200/**"]`. Eles alteram dados, então use um banco de testes e rode `npx supabase db reset` antes.

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
- **Estoque**: o saldo só muda por pedido, venda no balcão ou ajuste no painel (com histórico); nem o admin consegue editar o número direto.
- **Frete**: cotações são gravadas pela Edge Function com a chave de serviço; o visitante não lê nem cria cotações.
- **PDV, caixa e relatórios**: funções que conferem se quem chama é admin.
- **Pedidos** não podem ser lidos nem inseridos diretamente pelo público. Eles passam pela função `criar_pedido()`, que **recalcula** preços, taxa, pedido mínimo e troco no servidor, recusa itens esgotados e limita a 5 pedidos por telefone a cada 10 minutos.
- **Fotos**: o bucket é público para leitura pela URL; só o admin lista, envia, troca ou apaga.
- **Recuperação de senha**: a rota de retorno só redireciona para dentro de `/admin` (sem redirecionamento aberto) e a tela não revela se um e-mail tem conta.
- A atualização da vitrine (`revalidarLoja`) confere a sessão e a permissão de admin no servidor.
