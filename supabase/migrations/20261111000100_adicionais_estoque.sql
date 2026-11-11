-- =====================================================================
-- Adega011 · Adicionais (grupos de opções) e controle de estoque
-- =====================================================================

-- Funções internas ficam fora do schema exposto pela API.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Adicionais: cada produto pode ter grupos de opções
-- (ex.: "Energético" com Baly +R$ 3, Red Bull +R$ 6; mínimo 0, máximo 1)
-- ---------------------------------------------------------------------
create table if not exists public.grupos_opcoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60),
  minimo integer not null default 0 check (minimo >= 0),
  maximo integer not null default 1 check (maximo >= 1 and maximo <= 20),
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  check (minimo <= maximo)
);
create index if not exists grupos_opcoes_produto_idx on public.grupos_opcoes (produto_id, ordem);

create table if not exists public.opcoes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos_opcoes (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 60),
  preco integer not null default 0 check (preco >= 0),
  disponivel boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists opcoes_grupo_idx on public.opcoes (grupo_id, ordem);

alter table public.grupos_opcoes enable row level security;
alter table public.opcoes enable row level security;

drop policy if exists "grupos_opcoes_leitura" on public.grupos_opcoes;
create policy "grupos_opcoes_leitura" on public.grupos_opcoes for select to anon, authenticated using (true);
drop policy if exists "grupos_opcoes_admin" on public.grupos_opcoes;
create policy "grupos_opcoes_admin" on public.grupos_opcoes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "opcoes_leitura" on public.opcoes;
create policy "opcoes_leitura" on public.opcoes for select to anon, authenticated using (true);
drop policy if exists "opcoes_admin" on public.opcoes;
create policy "opcoes_admin" on public.opcoes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.grupos_opcoes, public.opcoes from anon, authenticated;
grant select on public.grupos_opcoes, public.opcoes to anon, authenticated;
grant insert, update, delete on public.grupos_opcoes, public.opcoes to authenticated;

-- ---------------------------------------------------------------------
-- Estoque
-- controla_estoque = false: produto vendido sem limite (como antes).
-- O saldo só muda por pedidos, vendas no balcão e pela função ajustar_estoque,
-- sempre deixando registro em estoque_movimentos.
-- ---------------------------------------------------------------------
alter table public.produtos
  add column if not exists controla_estoque boolean not null default false,
  add column if not exists estoque integer not null default 0;

-- O admin edita o produto, mas não o saldo diretamente (só via ajustar_estoque).
revoke insert, update on public.produtos from authenticated;
grant insert (categoria_id, nome, descricao, preco, foto_url, destaque, disponivel, ativo, ordem, controla_estoque)
  on public.produtos to authenticated;
grant update (categoria_id, nome, descricao, preco, foto_url, destaque, disponivel, ativo, ordem, controla_estoque)
  on public.produtos to authenticated;

-- Colunas novas dos pedidos (origem, desconto, caixa, estoque, distância)
alter table public.pedidos
  add column if not exists origem text not null default 'site' check (origem in ('site', 'balcao')),
  add column if not exists desconto integer not null default 0 check (desconto >= 0),
  add column if not exists valor_recebido integer check (valor_recebido is null or valor_recebido >= 0),
  add column if not exists distancia_km numeric(6, 1),
  add column if not exists estoque_baixado boolean not null default false,
  add column if not exists caixa_id uuid,
  add column if not exists atendente uuid references auth.users (id) on delete set null;

alter table public.pedidos drop constraint if exists pedidos_tipo_check;
alter table public.pedidos add constraint pedidos_tipo_check check (tipo in ('entrega', 'retirada', 'balcao'));

create index if not exists pedidos_caixa_idx on public.pedidos (caixa_id);

create table if not exists public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  quantidade integer not null, -- positivo entra, negativo sai
  saldo integer not null,      -- saldo depois do movimento
  motivo text not null check (motivo in ('pedido', 'cancelamento', 'reativacao', 'venda_balcao', 'entrada', 'ajuste')),
  pedido_id uuid references public.pedidos (id) on delete set null,
  observacao text,
  criado_por uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists estoque_movimentos_produto_idx on public.estoque_movimentos (produto_id, criado_em desc);

alter table public.estoque_movimentos enable row level security;
drop policy if exists "estoque_movimentos_admin_le" on public.estoque_movimentos;
create policy "estoque_movimentos_admin_le" on public.estoque_movimentos
  for select to authenticated using (public.is_admin());
revoke all on public.estoque_movimentos from anon, authenticated;
grant select on public.estoque_movimentos to authenticated;

-- Movimenta o saldo de um produto (ignora produtos sem controle de estoque).
create or replace function privado.movimentar_estoque(
  p_produto uuid,
  p_delta integer,
  p_motivo text,
  p_pedido uuid default null,
  p_observacao text default null,
  p_permitir_negativo boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_saldo integer;
  v_controla boolean;
begin
  if p_delta = 0 then
    return;
  end if;
  select nome, estoque, controla_estoque into v_nome, v_saldo, v_controla
    from public.produtos where id = p_produto for update;
  if not found or not v_controla then
    return;
  end if;
  if v_saldo + p_delta < 0 and not p_permitir_negativo then
    raise exception '% · só temos % em estoque.', v_nome, greatest(v_saldo, 0);
  end if;
  update public.produtos set estoque = v_saldo + p_delta where id = p_produto;
  insert into public.estoque_movimentos (produto_id, quantidade, saldo, motivo, pedido_id, observacao)
    values (p_produto, p_delta, v_saldo + p_delta, p_motivo, p_pedido, p_observacao);
end;
$$;

-- Ajuste manual pelo painel: 'entrada' soma; 'ajuste' define o saldo contado.
create or replace function public.ajustar_estoque(
  p_produto uuid,
  p_modo text,
  p_quantidade integer,
  p_observacao text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo integer;
  v_controla boolean;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão.';
  end if;
  if p_modo not in ('entrada', 'ajuste') or p_quantidade is null or p_quantidade < 0 or p_quantidade > 100000 then
    raise exception 'Quantidade inválida.';
  end if;
  select estoque, controla_estoque into v_saldo, v_controla from public.produtos where id = p_produto for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if not v_controla then
    update public.produtos set controla_estoque = true where id = p_produto;
  end if;
  perform privado.movimentar_estoque(
    p_produto,
    case when p_modo = 'entrada' then p_quantidade else p_quantidade - v_saldo end,
    p_modo,
    null,
    nullif(left(btrim(coalesce(p_observacao, '')), 200), ''),
    true
  );
  return (select estoque from public.produtos where id = p_produto);
end;
$$;

-- Devolve/rebaixa o estoque quando um pedido é cancelado/reativado ou apagado.
create or replace function privado.estoque_por_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if tg_op = 'DELETE' then
    if old.estoque_baixado and old.status <> 'cancelado' then
      for v_item in select * from jsonb_array_elements(old.itens) loop
        perform privado.movimentar_estoque((v_item ->> 'produto_id')::uuid, (v_item ->> 'quantidade')::integer,
          'cancelamento', null, 'Pedido #' || old.numero || ' apagado', true);
      end loop;
    end if;
    return old;
  end if;

  if new.estoque_baixado and old.status <> 'cancelado' and new.status = 'cancelado' then
    for v_item in select * from jsonb_array_elements(new.itens) loop
      perform privado.movimentar_estoque((v_item ->> 'produto_id')::uuid, (v_item ->> 'quantidade')::integer,
        'cancelamento', new.id, 'Pedido #' || new.numero || ' cancelado', true);
    end loop;
  elsif new.estoque_baixado and old.status = 'cancelado' and new.status <> 'cancelado' then
    for v_item in select * from jsonb_array_elements(new.itens) loop
      perform privado.movimentar_estoque((v_item ->> 'produto_id')::uuid, -((v_item ->> 'quantidade')::integer),
        'reativacao', new.id, 'Pedido #' || new.numero || ' reativado', false);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_estoque_status on public.pedidos;
create trigger pedidos_estoque_status after update of status on public.pedidos
  for each row execute function privado.estoque_por_status();
drop trigger if exists pedidos_estoque_apagado on public.pedidos;
create trigger pedidos_estoque_apagado before delete on public.pedidos
  for each row execute function privado.estoque_por_status();

revoke all on function privado.movimentar_estoque(uuid, integer, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.ajustar_estoque(uuid, text, integer, text) from public, anon;
grant execute on function public.ajustar_estoque(uuid, text, integer, text) to authenticated;
