-- Kits share the stock of their components. All quantities use integer base
-- units: individual pieces (un) or millilitres (ml).
alter table public.produtos
  add column eh_kit boolean not null default false,
  add column unidade_estoque text not null default 'un' check (unidade_estoque in ('un','ml')),
  add column volume_unidade integer not null default 1 check (volume_unidade between 1 and 1000000);
alter table public.pedidos add column consumo_estoque jsonb;
alter table public.estoque_movimentos add column unidade text not null default 'un';
grant insert (eh_kit,unidade_estoque,volume_unidade), update (eh_kit,unidade_estoque,volume_unidade) on public.produtos to authenticated;

create table public.kit_componentes (
  kit_id uuid not null references public.produtos(id) on delete cascade,
  componente_id uuid not null references public.produtos(id) on delete restrict,
  quantidade integer not null check (quantidade between 1 and 1000000),
  primary key (kit_id,componente_id),
  check (kit_id <> componente_id)
);
create index kit_componentes_componente_idx on public.kit_componentes(componente_id);
alter table public.kit_componentes enable row level security;
revoke all on public.kit_componentes from public,anon,authenticated;
grant select on public.kit_componentes to authenticated;
create policy kit_componentes_admin_le on public.kit_componentes for select to authenticated using ((select public.is_admin()));

-- Preserve exactly what older sales originally consumed, not today's recipe.
update public.pedidos p set consumo_estoque = coalesce((
  select jsonb_agg(jsonb_build_object('produto_id',m.produto_id,'quantidade',m.quantidade,'unidade','un'))
  from (select em.produto_id, -sum(em.quantidade) as quantidade
        from public.estoque_movimentos em where em.pedido_id=p.id and em.motivo in ('pedido','venda_balcao')
        group by em.produto_id) m
), '[]'::jsonb) where p.estoque_baixado;

create or replace function privado.validar_modelo_estoque()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.unidade_estoque <> old.unidade_estoque then
    if old.estoque <> 0 or exists(select 1 from public.estoque_movimentos m where m.produto_id=old.id)
      or exists(select 1 from public.kit_componentes c where c.componente_id=old.id) then
      raise exception 'A unidade não pode mudar após movimentações ou vínculos de kits. Cadastre um novo produto base para ml.';
    end if;
  end if;
  if new.unidade_estoque='un' then new.volume_unidade:=1; end if;
  if new.eh_kit then
    if tg_op='UPDATE' and not old.eh_kit and exists(select 1 from public.estoque_movimentos m where m.produto_id=old.id) then
      raise exception 'Este produto tem histórico próprio de estoque. Crie um kit separado para preservar as movimentações.';
    end if;
    if new.estoque <> 0 then raise exception 'Zere o estoque próprio antes de transformar o produto em kit.'; end if;
    if exists(select 1 from public.kit_componentes c where c.componente_id=new.id) then
      raise exception 'Este produto já é componente de outro kit. Kits devem usar produtos simples.';
    end if;
    new.controla_estoque:=false;
    new.unidade_estoque:='un'; new.volume_unidade:=1;
  elsif tg_op='UPDATE' and old.eh_kit then
    delete from public.kit_componentes where kit_id=old.id;
  end if;
  if not new.controla_estoque and not new.eh_kit and exists(select 1 from public.kit_componentes c where c.componente_id=new.id) then
    raise exception 'Este produto abastece kits e precisa continuar com controle de estoque.';
  end if;
  return new;
end;
$$;
create trigger produtos_modelo_estoque before insert or update on public.produtos
for each row execute function privado.validar_modelo_estoque();
revoke all on function privado.validar_modelo_estoque() from public,anon,authenticated;

create or replace function public.salvar_composicao_kit(p_kit uuid,p_componentes jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v jsonb; v_prod public.produtos%rowtype;
begin
  perform privado.exigir_admin();
  -- Same serialization point as sales: compositions cannot change mid-sale.
  perform pg_advisory_xact_lock(11011011);
  select * into v_prod from public.produtos where id=p_kit for update;
  if not found or not v_prod.eh_kit then raise exception 'Salve o produto como kit primeiro.'; end if;
  if p_componentes is null or jsonb_typeof(p_componentes)<>'array' or jsonb_array_length(p_componentes)>50 then
    raise exception 'Composição inválida (máximo 50 componentes).';
  end if;
  if (select count(distinct e->>'componente_id') from jsonb_array_elements(p_componentes)e) <> jsonb_array_length(p_componentes) then
    raise exception 'Componente repetido.';
  end if;
  for v in select * from jsonb_array_elements(p_componentes) loop
    select * into v_prod from public.produtos where id=(v->>'componente_id')::uuid for update;
    if not found or v_prod.id=p_kit or v_prod.eh_kit or not v_prod.controla_estoque then
      raise exception 'Escolha produtos simples com controle de estoque ativo.';
    end if;
    if (v->>'quantidade') is null or (v->>'quantidade') !~ '^[0-9]+$' or (v->>'quantidade')::numeric not between 1 and 1000000 then
      raise exception 'Informe uma quantidade inteira positiva na unidade do componente.';
    end if;
  end loop;
  delete from public.kit_componentes where kit_id=p_kit;
  insert into public.kit_componentes(kit_id,componente_id,quantidade)
  select p_kit,(e->>'componente_id')::uuid,(e->>'quantidade')::integer from jsonb_array_elements(p_componentes)e;
end;
$$;
revoke all on function public.salvar_composicao_kit(uuid,jsonb) from public,anon;
grant execute on function public.salvar_composicao_kit(uuid,jsonb) to authenticated;

-- Only saleable counts are exposed publicly; component recipes stay admin-only.
create or replace function public.saldos_venda()
returns table(produto_id uuid,saldo integer)
language sql stable security definer set search_path='' as $$
  select p.id, case when p.eh_kit then coalesce((
      select min(greatest(c.estoque,0)/k.quantidade)
      from public.kit_componentes k join public.produtos c on c.id=k.componente_id
      where k.kit_id=p.id
    ),0)::integer
    when p.controla_estoque then greatest(p.estoque,0)/p.volume_unidade
    else 2147483647 end
  from public.produtos p where p.ativo or public.is_admin();
$$;
revoke all on function public.saldos_venda() from public;
grant execute on function public.saldos_venda() to anon,authenticated;

create or replace function privado.consumo_itens(p_itens jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb; v_prod public.produtos%rowtype; v_result jsonb;
begin
  for v in select * from jsonb_array_elements(p_itens) loop
    select * into v_prod from public.produtos where id=(v->>'produto_id')::uuid;
    if v_prod.eh_kit and not exists(select 1 from public.kit_componentes where kit_id=v_prod.id) then
      raise exception '% está sem composição. Configure os componentes antes de vender.',v_prod.nome;
    end if;
  end loop;
  with linhas as (
    select p.*, (e->>'quantidade')::bigint qtd
    from jsonb_array_elements(p_itens)e join public.produtos p on p.id=(e->>'produto_id')::uuid
  ), consumo as (
    select l.id produto_id,l.qtd*l.volume_unidade quantidade from linhas l where not l.eh_kit and l.controla_estoque
    union all
    select k.componente_id,l.qtd*k.quantidade from linhas l join public.kit_componentes k on k.kit_id=l.id where l.eh_kit
  ), somado as (select produto_id,sum(quantidade) quantidade from consumo group by produto_id)
  select coalesce(jsonb_agg(jsonb_build_object('produto_id',c.produto_id,'quantidade',c.quantidade,'unidade',p.unidade_estoque,'nome',p.nome) order by c.produto_id),'[]'::jsonb)
  into v_result from somado c join public.produtos p on p.id=c.produto_id;
  if exists(select 1 from jsonb_array_elements(v_result)e where (e->>'quantidade')::numeric>2147483647) then
    raise exception 'Quantidade de estoque excede o limite.';
  end if;
  return v_result;
end;
$$;
revoke all on function privado.consumo_itens(jsonb) from public,anon,authenticated;

create or replace function privado.movimentar_estoque(
 p_produto uuid,p_delta integer,p_motivo text,p_pedido uuid default null,p_observacao text default null,p_permitir_negativo boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare v_prod public.produtos%rowtype; v_novo bigint;
begin
  if p_delta=0 then return; end if;
  select * into v_prod from public.produtos where id=p_produto for update;
  if not found then return; end if;
  v_novo:=v_prod.estoque::bigint+p_delta;
  if v_novo<0 and not p_permitir_negativo then
    raise exception '% · saldo insuficiente: % % disponíveis.',v_prod.nome,greatest(v_prod.estoque,0),v_prod.unidade_estoque;
  end if;
  if v_novo>2147483647 then raise exception 'Saldo acima do limite.'; end if;
  update public.produtos set estoque=v_novo::integer where id=p_produto;
  insert into public.estoque_movimentos(produto_id,quantidade,saldo,motivo,pedido_id,observacao,unidade)
  values(p_produto,p_delta,v_novo::integer,p_motivo,p_pedido,p_observacao,v_prod.unidade_estoque);
end;
$$;

create or replace function privado.baixar_estoque(p_pedido uuid,p_itens jsonb,p_motivo text,p_numero bigint)
returns void language plpgsql security definer set search_path='' as $$
declare v_consumo jsonb; v jsonb;
begin
  v_consumo:=privado.consumo_itens(p_itens);
  for v in select * from jsonb_array_elements(v_consumo) loop
    perform privado.movimentar_estoque((v->>'produto_id')::uuid,-(v->>'quantidade')::integer,p_motivo,p_pedido,'Pedido #'||p_numero,false);
  end loop;
  update public.pedidos set estoque_baixado=true,consumo_estoque=v_consumo where id=p_pedido;
end;
$$;

create or replace function privado.estoque_por_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb; v_delta integer; v_motivo text; v_consumo jsonb; v_pedido uuid;
begin
  if tg_op='DELETE' then
    if not old.estoque_baixado or old.status='cancelado' then return old; end if;
    v_delta:=1;v_motivo:='cancelamento';v_consumo:=old.consumo_estoque;v_pedido:=null;
  else
    if not old.estoque_baixado then return new; end if;
    if old.status<>'cancelado' and new.status='cancelado' then v_delta:=1;v_motivo:='cancelamento';
    elsif old.status='cancelado' and new.status<>'cancelado' then v_delta:=-1;v_motivo:='reativacao';
    else return new;end if;
    v_consumo:=old.consumo_estoque;v_pedido:=new.id;
  end if;
  perform pg_advisory_xact_lock(11011011);
  for v in select * from jsonb_array_elements(coalesce(v_consumo,'[]'::jsonb)) order by value->>'produto_id' loop
    perform privado.movimentar_estoque((v->>'produto_id')::uuid,v_delta*(v->>'quantidade')::integer,v_motivo,v_pedido,'Pedido #'||old.numero,false);
  end loop;
  if tg_op='DELETE' then return old;end if;return new;
end;
$$;

create or replace function public.ajustar_estoque(p_produto uuid,p_modo text,p_quantidade integer,p_observacao text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_prod public.produtos%rowtype;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_modo is null or p_modo not in ('entrada','ajuste') or p_quantidade is null or p_quantidade<0 or p_quantidade>1000000000 then
    raise exception 'Quantidade inválida.';
  end if;
  select * into v_prod from public.produtos where id=p_produto for update;
  if not found then raise exception 'Produto não encontrado.';end if;
  if v_prod.eh_kit then raise exception 'Lance o estoque nos componentes do kit.';end if;
  update public.produtos set controla_estoque=true where id=p_produto;
  perform privado.movimentar_estoque(p_produto,case when p_modo='entrada' then p_quantidade else p_quantidade-v_prod.estoque end,p_modo,null,nullif(left(btrim(coalesce(p_observacao,'')),200),''),false);
  return (select estoque from public.produtos where id=p_produto);
end;
$$;

-- Serialize sales, stock adjustments and recipe changes in this small single
-- store, before any product-row locks. No partial consumption on failure.
create or replace function privado.travar_estoque()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform pg_advisory_xact_lock(11011011);return null;end;
$$;
create trigger produtos_trava_estoque before insert or update or delete on public.produtos
for each statement execute function privado.travar_estoque();
create trigger pedidos_trava_estoque before insert or update or delete on public.pedidos
for each statement execute function privado.travar_estoque();
revoke all on function privado.travar_estoque() from public,anon,authenticated;

-- Only status is editable through the admin API; consumption is server-owned.
revoke update on public.pedidos from authenticated;
grant update(status) on public.pedidos to authenticated;

notify pgrst,'reload schema';


create or replace function privado.montar_itens(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_prod public.produtos%rowtype;
  v_grupo public.grupos_opcoes%rowtype;
  v_qtd integer;
  v_ops jsonb;
  v_n integer;
  v_validas integer;
  v_extra integer;
  v_snap jsonb;
  v_unit integer;
  v_itens jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_total_produto jsonb := '{}'::jsonb;
  v_ja integer;
begin
  perform pg_advisory_xact_lock(11011011);
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 60 then
    raise exception 'Seu carrinho está vazio.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'quantidade')::integer;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida no carrinho.';
    end if;

    select * into v_prod from public.produtos pr
      where pr.id = (v_item ->> 'produto_id')::uuid and pr.ativo
      for update;
    if not found then
      raise exception 'Um dos produtos do carrinho não está mais disponível.';
    end if;
    if not v_prod.disponivel then
      raise exception '% está esgotado.', v_prod.nome;
    end if;

    -- Estoque (somando o mesmo produto em linhas com adicionais diferentes)
    v_ja := coalesce((v_total_produto ->> v_prod.id::text)::integer, 0) + v_qtd;
    v_total_produto := v_total_produto || jsonb_build_object(v_prod.id::text, v_ja);
    if v_prod.controla_estoque and v_ja > v_prod.estoque then
      if v_prod.estoque <= 0 then
        raise exception '% está esgotado.', v_prod.nome;
      end if;
      raise exception '% · só temos % em estoque.', v_prod.nome, v_prod.estoque;
    end if;

    -- Adicionais
    v_ops := coalesce(v_item -> 'opcoes', '[]'::jsonb);
    if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) > 40 then
      raise exception 'Adicionais inválidos.';
    end if;
    if (select count(distinct e) from jsonb_array_elements_text(v_ops) e) <> jsonb_array_length(v_ops) then
      raise exception 'Adicional repetido no pedido.';
    end if;

    select count(*), coalesce(sum(o.preco), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'grupo', g.nome, 'nome', o.nome, 'preco', o.preco)
                     order by g.ordem, o.ordem), '[]'::jsonb)
      into v_validas, v_extra, v_snap
      from jsonb_array_elements_text(v_ops) e
      join public.opcoes o on o.id = e::uuid
      join public.grupos_opcoes g on g.id = o.grupo_id
     where g.produto_id = v_prod.id and o.disponivel;
    if v_validas <> jsonb_array_length(v_ops) then
      raise exception 'Um adicional de % não está mais disponível.', v_prod.nome;
    end if;

    for v_grupo in select * from public.grupos_opcoes g where g.produto_id = v_prod.id loop
      select count(*) into v_n
        from jsonb_array_elements_text(v_ops) e join public.opcoes o on o.id = e::uuid
       where o.grupo_id = v_grupo.id;
      if v_n < v_grupo.minimo then
        raise exception 'Escolha % em "%" (%).', v_grupo.minimo, v_grupo.nome, v_prod.nome;
      end if;
      if v_n > v_grupo.maximo then
        raise exception 'Escolha no máximo % em "%" (%).', v_grupo.maximo, v_grupo.nome, v_prod.nome;
      end if;
    end loop;

    v_unit := v_prod.preco + v_extra;
    v_subtotal := v_subtotal + v_unit * v_qtd;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'produto_id', v_prod.id,
      'nome', v_prod.nome,
      'preco', v_unit,
      'preco_base', v_prod.preco,
      'quantidade', v_qtd,
      'opcoes', v_snap
    ));
  end loop;

  return jsonb_build_object('itens', v_itens, 'subtotal', v_subtotal);
end;
$$;
