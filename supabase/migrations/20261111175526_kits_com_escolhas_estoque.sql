alter table public.opcoes
  add column componente_id uuid references public.produtos(id) on delete restrict,
  add column quantidade_consumo integer,
  add constraint opcoes_consumo_valido check (
    (componente_id is null and quantidade_consumo is null) or
    (componente_id is not null and quantidade_consumo is not null and quantidade_consumo between 1 and 1000000));
create index opcoes_componente_idx on public.opcoes(componente_id) where componente_id is not null;

create function privado.validar_consumo_opcao() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(11011011);
  if new.componente_id is not null and not exists(select 1 from public.produtos p where p.id=new.componente_id and not p.eh_kit and p.controla_estoque) then
    raise exception 'Escolha um produto simples com controle de estoque para este adicional.';
  end if;
  return new;
end;$$;
revoke all on function privado.validar_consumo_opcao() from public,anon,authenticated;
create trigger opcoes_validar_consumo before insert or update on public.opcoes for each row execute function privado.validar_consumo_opcao();

create function privado.serializar_escolhas() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pg_advisory_xact_lock(11011011); return null;end;$$;
revoke all on function privado.serializar_escolhas() from public,anon,authenticated;
create trigger opcoes_serializar before insert or update or delete on public.opcoes for each statement execute function privado.serializar_escolhas();
create trigger grupos_serializar before insert or update or delete on public.grupos_opcoes for each statement execute function privado.serializar_escolhas();

create function privado.proteger_base_opcoes() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.eh_kit or not new.controla_estoque or new.unidade_estoque is distinct from old.unidade_estoque)
    and exists(select 1 from public.opcoes o where o.componente_id=old.id) then
    raise exception 'Este produto abastece escolhas de kits. Preserve sua unidade e o controle de estoque.';
  end if;
  return new;
end;$$;
revoke all on function privado.proteger_base_opcoes() from public,anon,authenticated;
create trigger produtos_proteger_base_opcoes before update on public.produtos for each row execute function privado.proteger_base_opcoes();

create function public.saldos_opcoes() returns table(opcao_id uuid,saldo integer)
language sql stable security definer set search_path='' as $$
  select o.id,case when not o.disponivel then 0 when o.componente_id is null then 2147483647
    when p.controla_estoque and not p.eh_kit then greatest(p.estoque,0)/o.quantidade_consumo else 0 end
  from public.opcoes o join public.grupos_opcoes g on g.id=o.grupo_id
  join public.produtos dono on dono.id=g.produto_id left join public.produtos p on p.id=o.componente_id
  where dono.ativo or public.is_admin();
$$;
revoke all on function public.saldos_opcoes() from public;
grant execute on function public.saldos_opcoes() to anon,authenticated;

create or replace function public.saldos_venda() returns table(produto_id uuid,saldo integer)
language sql stable security definer set search_path='' as $$
  with saldos as (select * from public.saldos_opcoes()),
  grupos as (
    select g.produto_id,g.id,
      coalesce((select so.saldo from public.opcoes o join saldos so on so.opcao_id=o.id
        where o.grupo_id=g.id and o.disponivel order by so.saldo desc offset greatest(g.minimo-1,0) limit 1),0) saldo
    from public.grupos_opcoes g where g.minimo>0
  )
  select p.id,case when p.eh_kit then
    case when exists(select 1 from public.kit_componentes k where k.kit_id=p.id)
      or (exists(select 1 from grupos g where g.produto_id=p.id) and exists(select 1 from public.opcoes o join public.grupos_opcoes g on g.id=o.grupo_id where g.produto_id=p.id and g.minimo>0 and o.componente_id is not null)) then
      least(coalesce((select min(greatest(c.estoque,0)/k.quantidade) from public.kit_componentes k join public.produtos c on c.id=k.componente_id where k.kit_id=p.id),2147483647),
        coalesce((select min(g.saldo) from grupos g where g.produto_id=p.id),2147483647))::integer
    else 0 end
    when p.controla_estoque then greatest(p.estoque,0)/p.volume_unidade else 2147483647 end
  from public.produtos p where p.ativo or public.is_admin();
$$;

create or replace function privado.consumo_itens(p_itens jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb; v_prod public.produtos%rowtype; v_result jsonb;
begin
  for v in select * from jsonb_array_elements(p_itens) loop
    select * into v_prod from public.produtos where id=(v->>'produto_id')::uuid;
    if v_prod.eh_kit and not exists(select 1 from public.kit_componentes where kit_id=v_prod.id)
      and not exists(select 1 from jsonb_array_elements(coalesce(v->'opcoes','[]')) e
        join public.opcoes o on o.id=(case when jsonb_typeof(e)='object' then e->>'id' else e#>>'{}' end)::uuid
        join public.grupos_opcoes g on g.id=o.grupo_id
        where g.produto_id=v_prod.id and g.minimo>0 and o.componente_id is not null) then
      raise exception '% está sem composição. Configure os componentes ou as escolhas obrigatórias antes de vender.',v_prod.nome;
    end if;
  end loop;
  with linhas as (
    select p.*, (e->>'quantidade')::bigint qtd,coalesce(e->'opcoes','[]') escolhas
    from jsonb_array_elements(p_itens)e join public.produtos p on p.id=(e->>'produto_id')::uuid
  ), consumo as (
    select l.id produto_id,l.qtd*l.volume_unidade quantidade from linhas l where not l.eh_kit and l.controla_estoque
    union all
    select k.componente_id,l.qtd*k.quantidade from linhas l join public.kit_componentes k on k.kit_id=l.id where l.eh_kit
    union all
    select o.componente_id,l.qtd*o.quantidade_consumo from linhas l
      cross join lateral jsonb_array_elements(l.escolhas)e
      join public.opcoes o on o.id=(case when jsonb_typeof(e)='object' then e->>'id' else e#>>'{}' end)::uuid
      join public.grupos_opcoes g on g.id=o.grupo_id and g.produto_id=l.id
      where o.componente_id is not null
  ), somado as (select produto_id,sum(quantidade) quantidade from consumo group by produto_id)
  select coalesce(jsonb_agg(jsonb_build_object('produto_id',c.produto_id,'quantidade',c.quantidade,'unidade',p.unidade_estoque,'nome',p.nome) order by c.produto_id),'[]')
  into v_result from somado c join public.produtos p on p.id=c.produto_id;
  if exists(select 1 from jsonb_array_elements(v_result)e where (e->>'quantidade')::numeric>2147483647) then
    raise exception 'Quantidade de estoque excede o limite.';
  end if;
  return v_result;
end;$$;
revoke all on function privado.consumo_itens(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
