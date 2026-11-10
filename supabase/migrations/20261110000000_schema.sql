-- =====================================================================
-- Adega011 · schema, segurança (RLS), função de pedido e storage
-- Rode este arquivo inteiro no SQL Editor do Supabase (ou `supabase db push`).
-- Valores monetários são guardados em CENTAVOS (integer).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------
-- Configurações da loja (linha única, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.configuracoes (
  id integer primary key default 1 check (id = 1),
  nome text not null default 'Adega011',
  slogan text not null default 'São Paulo no copo',
  whatsapp text not null default '' check (whatsapp ~ '^[0-9]*$'),
  endereco text not null default '',
  instagram text not null default '',
  horarios jsonb not null default '{}'::jsonb,
  status_manual text not null default 'auto' check (status_manual in ('auto', 'aberta', 'fechada')),
  pedido_minimo integer not null default 0 check (pedido_minimo >= 0),
  aceita_entrega boolean not null default true,
  aceita_retirada boolean not null default true,
  pagamentos text[] not null default array['pix', 'cartao', 'dinheiro']
    check (pagamentos <@ array['pix', 'cartao', 'dinheiro']),
  chave_pix text not null default '',
  tempo_entrega text not null default '',
  banner_titulo text not null default 'São Paulo no copo',
  banner_texto text not null default '',
  banner_botao_texto text not null default 'Ver cardápio',
  banner_botao_link text not null default '#cardapio',
  banner_imagem_url text,
  atualizado_em timestamptz not null default now()
);

insert into public.configuracoes (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  ordem integer not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references public.categorias (id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 100),
  descricao text not null default '' check (char_length(descricao) <= 500),
  preco integer not null check (preco >= 0),
  foto_url text,
  destaque boolean not null default false,
  disponivel boolean not null default true,
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists produtos_categoria_idx on public.produtos (categoria_id, ordem);

create table if not exists public.regioes_entrega (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 80),
  taxa integer not null default 0 check (taxa >= 0),
  ordem integer not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pedidos (histórico). O público NUNCA lê nem grava direto:
-- a criação passa pela função criar_pedido(), que recalcula tudo.
-- ---------------------------------------------------------------------
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity (start with 1001) unique,
  criado_em timestamptz not null default now(),
  status text not null default 'novo'
    check (status in ('novo', 'confirmado', 'em_entrega', 'concluido', 'cancelado')),
  cliente_nome text not null,
  cliente_telefone text not null,
  tipo text not null check (tipo in ('entrega', 'retirada')),
  regiao_nome text,
  endereco text,
  pagamento text not null check (pagamento in ('pix', 'cartao', 'dinheiro')),
  troco_para integer check (troco_para is null or troco_para >= 0),
  observacoes text,
  itens jsonb not null,
  subtotal integer not null,
  taxa integer not null default 0,
  total integer not null
);

create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);
create index if not exists pedidos_telefone_idx on public.pedidos (cliente_telefone, criado_em desc);

-- Atualiza "atualizado_em"
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists produtos_atualizado_em on public.produtos;
create trigger produtos_atualizado_em before update on public.produtos
  for each row execute function public.tocar_atualizado_em();

drop trigger if exists configuracoes_atualizado_em on public.configuracoes;
create trigger configuracoes_atualizado_em before update on public.configuracoes
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.configuracoes enable row level security;
alter table public.categorias enable row level security;
alter table public.produtos enable row level security;
alter table public.regioes_entrega enable row level security;
alter table public.pedidos enable row level security;

-- admins: cada usuário só enxerga a própria linha (para o painel saber se é admin)
drop policy if exists "admins_ve_a_si_mesmo" on public.admins;
create policy "admins_ve_a_si_mesmo" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- configuracoes: público lê, admin altera
drop policy if exists "config_leitura_publica" on public.configuracoes;
create policy "config_leitura_publica" on public.configuracoes
  for select to anon, authenticated using (true);
drop policy if exists "config_admin_altera" on public.configuracoes;
create policy "config_admin_altera" on public.configuracoes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- categorias / produtos / regiões: público lê apenas o que está ativo; admin faz tudo
drop policy if exists "categorias_leitura" on public.categorias;
create policy "categorias_leitura" on public.categorias
  for select to anon, authenticated using (ativa or public.is_admin());
drop policy if exists "categorias_admin" on public.categorias;
create policy "categorias_admin" on public.categorias
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "produtos_leitura" on public.produtos;
create policy "produtos_leitura" on public.produtos
  for select to anon, authenticated using (ativo or public.is_admin());
drop policy if exists "produtos_admin" on public.produtos;
create policy "produtos_admin" on public.produtos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "regioes_leitura" on public.regioes_entrega;
create policy "regioes_leitura" on public.regioes_entrega
  for select to anon, authenticated using (ativa or public.is_admin());
drop policy if exists "regioes_admin" on public.regioes_entrega;
create policy "regioes_admin" on public.regioes_entrega
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- pedidos: somente admin lê, altera e remove (sem política de insert = ninguém insere direto)
drop policy if exists "pedidos_admin_le" on public.pedidos;
create policy "pedidos_admin_le" on public.pedidos
  for select to authenticated using (public.is_admin());
drop policy if exists "pedidos_admin_altera" on public.pedidos;
create policy "pedidos_admin_altera" on public.pedidos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "pedidos_admin_remove" on public.pedidos;
create policy "pedidos_admin_remove" on public.pedidos
  for delete to authenticated using (public.is_admin());

-- Permissões explícitas (o RLS acima decide o que cada um vê).
-- O Supabase concede ALL por padrão às roles da API; removemos o que não é usado
-- (defesa em profundidade: mesmo sem RLS, o visitante anônimo só consegue ler).
revoke all on public.configuracoes, public.categorias, public.produtos, public.regioes_entrega,
  public.pedidos, public.admins from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.configuracoes, public.categorias, public.produtos, public.regioes_entrega to anon, authenticated;
grant update on public.configuracoes to authenticated;
grant insert, update, delete on public.categorias, public.produtos, public.regioes_entrega to authenticated;
grant select, update, delete on public.pedidos to authenticated;
grant select on public.admins to authenticated;
revoke all on public.pedidos from anon;
revoke insert on public.pedidos from authenticated;

-- ---------------------------------------------------------------------
-- criar_pedido: registra o pedido recalculando preços, taxa e mínimo
-- no servidor (o cliente não consegue adulterar valores).
-- p_itens: [{"produto_id": "uuid", "quantidade": 2}, ...]
-- ---------------------------------------------------------------------
create or replace function public.criar_pedido(
  p_cliente_nome text,
  p_cliente_telefone text,
  p_tipo text,
  p_regiao_id uuid,
  p_endereco text,
  p_pagamento text,
  p_troco_para integer,
  p_observacoes text,
  p_itens jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.configuracoes%rowtype;
  v_prod public.produtos%rowtype;
  v_regiao public.regioes_entrega%rowtype;
  v_item jsonb;
  v_qtd integer;
  v_itens jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_taxa integer := 0;
  v_telefone text := regexp_replace(coalesce(p_cliente_telefone, ''), '\D', '', 'g');
  v_recentes integer;
  v_id uuid;
  v_numero bigint;
begin
  select * into v_cfg from public.configuracoes c where c.id = 1;

  if v_cfg.status_manual = 'fechada' then
    raise exception 'A loja está fechada no momento.';
  end if;

  if coalesce(btrim(p_cliente_nome), '') = '' or char_length(p_cliente_nome) > 80 then
    raise exception 'Informe seu nome.';
  end if;

  if char_length(v_telefone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  -- Proteção simples contra abuso: no máximo 5 pedidos por telefone a cada 10 min.
  select count(*) into v_recentes from public.pedidos pe
    where pe.cliente_telefone = v_telefone and pe.criado_em > now() - interval '10 minutes';
  if v_recentes >= 5 then
    raise exception 'Muitos pedidos em sequência. Aguarde alguns minutos ou chame no WhatsApp.';
  end if;

  if p_tipo not in ('entrega', 'retirada') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  if p_tipo = 'entrega' and not v_cfg.aceita_entrega then
    raise exception 'No momento não estamos fazendo entregas.';
  end if;
  if p_tipo = 'retirada' and not v_cfg.aceita_retirada then
    raise exception 'No momento não estamos aceitando retirada na loja.';
  end if;

  if p_pagamento is null or not (p_pagamento = any (v_cfg.pagamentos)) then
    raise exception 'Forma de pagamento indisponível.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 50 then
    raise exception 'Seu carrinho está vazio.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'quantidade')::integer;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida no carrinho.';
    end if;

    select * into v_prod from public.produtos pr
      where pr.id = (v_item ->> 'produto_id')::uuid and pr.ativo;
    if not found then
      raise exception 'Um dos produtos do carrinho não está mais disponível.';
    end if;
    if not v_prod.disponivel then
      raise exception '% está esgotado.', v_prod.nome;
    end if;

    v_subtotal := v_subtotal + v_prod.preco * v_qtd;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'produto_id', v_prod.id,
      'nome', v_prod.nome,
      'preco', v_prod.preco,
      'quantidade', v_qtd
    ));
  end loop;

  if v_subtotal < v_cfg.pedido_minimo then
    raise exception 'O pedido mínimo é de R$ %.', replace(to_char(v_cfg.pedido_minimo / 100.0, 'FM999990.00'), '.', ',');
  end if;

  if p_tipo = 'entrega' then
    select * into v_regiao from public.regioes_entrega r where r.id = p_regiao_id and r.ativa;
    if not found then
      raise exception 'Selecione uma região de entrega válida.';
    end if;
    if coalesce(btrim(p_endereco), '') = '' then
      raise exception 'Informe o endereço de entrega.';
    end if;
    v_taxa := v_regiao.taxa;
  end if;

  if p_pagamento = 'dinheiro' and p_troco_para is not null and p_troco_para < v_subtotal + v_taxa then
    raise exception 'O valor para troco é menor que o total do pedido.';
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, regiao_nome, endereco, pagamento,
    troco_para, observacoes, itens, subtotal, taxa, total
  ) values (
    btrim(p_cliente_nome),
    v_telefone,
    p_tipo,
    case when p_tipo = 'entrega' then v_regiao.nome end,
    case when p_tipo = 'entrega' then left(btrim(p_endereco), 300) end,
    p_pagamento,
    case when p_pagamento = 'dinheiro' then p_troco_para end,
    nullif(left(btrim(coalesce(p_observacoes, '')), 500), ''),
    v_itens,
    v_subtotal,
    v_taxa,
    v_subtotal + v_taxa
  )
  returning id, numero into v_id, v_numero;

  return jsonb_build_object(
    'id', v_id,
    'numero', v_numero,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa
  );
end;
$$;

revoke all on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb) from public;
grant execute on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: o painel recebe pedidos novos sem recarregar
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
     ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Storage: bucket público "produtos" (fotos de produtos e banner)
-- Leitura pública pela URL; somente admin envia/altera/remove.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true;

drop policy if exists "fotos_admin_insere" on storage.objects;
create policy "fotos_admin_insere" on storage.objects
  for insert to authenticated with check (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "fotos_admin_altera" on storage.objects;
create policy "fotos_admin_altera" on storage.objects
  for update to authenticated using (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "fotos_admin_remove" on storage.objects;
create policy "fotos_admin_remove" on storage.objects
  for delete to authenticated using (bucket_id = 'produtos' and public.is_admin());
