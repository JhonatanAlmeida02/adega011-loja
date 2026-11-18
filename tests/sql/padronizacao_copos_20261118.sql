-- Executar com psql a partir deste arquivo: todos os ajustes são desfeitos.
begin;
do $antes$ begin perform set_config('qa.produtos_antes',(select jsonb_agg(to_jsonb(p) order by id)::text from public.produtos p),true);perform set_config('qa.kits_antes',(select jsonb_agg(to_jsonb(k) order by kit_id,componente_id)::text from public.kit_componentes k),true);end;$antes$;
\ir ../../scripts/sql/padronizar_copos_skus_20261118.sql
do $teste$
declare cup record;
begin
  if (select jsonb_agg(to_jsonb(p) order by id) from public.produtos p) is distinct from current_setting('qa.produtos_antes')::jsonb then raise exception 'Alterou produto/saldo/preço.'; end if;
  if (select jsonb_agg(to_jsonb(k) order by kit_id,componente_id) from public.kit_componentes k) is distinct from current_setting('qa.kits_antes')::jsonb then raise exception 'Alterou receita fixa.'; end if;
  if exists(select 1 from public.produtos p left join public.produto_importacao i on i.produto_id=p.id where nullif(btrim(i.codigo),'') is null) then raise exception 'Produto sem SKU.'; end if;
  if exists(select 1 from public.produtos p join public.produto_importacao i on i.produto_id=p.id where p.familia_id is not null and nullif(btrim(i.codigo_pai),'') is null) then raise exception 'Pai sem SKU.'; end if;
  for cup in select * from public.produtos where eh_kit and nome ilike 'COPÃO %' loop
    if not exists(select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Licor' and g.minimo=0 and g.maximo=1 and o.nome='FRAMBOESA' and o.preco=300 and o.disponivel) then raise exception 'Licor inválido: %',cup.nome; end if;
    if (select count(*) from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Gelo de sabor' and g.minimo=1 and g.maximo=1 and o.preco=0 and o.quantidade_consumo=1 and o.componente_id is not null)<>5 then raise exception 'Gelo inválido: %',cup.nome; end if;
    if exists(select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Energético' and (o.quantidade_consumo<>400 or o.componente_id is null or o.preco<>case when cup.preco<2000 and o.nome like 'BALY %' then 300 else 0 end or (cup.preco>=2000 and o.nome not like 'BALY %'))) then raise exception 'Energetico inválido: %',cup.nome; end if;
    if (select count(*) from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Energético')<>(case when cup.preco>=2000 then 7 else 12 end) then raise exception 'Quantidade energético inválida: %',cup.nome; end if;
  end loop;
end;
$teste$;
do $repeat$ begin perform set_config('qa.opcoes_repeat',(select jsonb_agg(to_jsonb(o) order by id)::text from public.opcoes o),true);end;$repeat$;
\ir ../../scripts/sql/padronizar_copos_skus_20261118.sql
do $teste$
declare cup record;
begin
  if (select jsonb_agg(to_jsonb(p) order by id) from public.produtos p) is distinct from current_setting('qa.produtos_antes')::jsonb then raise exception 'Alterou produto/saldo/preço.'; end if;
  if (select jsonb_agg(to_jsonb(k) order by kit_id,componente_id) from public.kit_componentes k) is distinct from current_setting('qa.kits_antes')::jsonb then raise exception 'Alterou receita fixa.'; end if;
  if exists(select 1 from public.produtos p left join public.produto_importacao i on i.produto_id=p.id where nullif(btrim(i.codigo),'') is null) then raise exception 'Produto sem SKU.'; end if;
  if exists(select 1 from public.produtos p join public.produto_importacao i on i.produto_id=p.id where p.familia_id is not null and nullif(btrim(i.codigo_pai),'') is null) then raise exception 'Pai sem SKU.'; end if;
  for cup in select * from public.produtos where eh_kit and nome ilike 'COPÃO %' loop
    if not exists(select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Licor' and g.minimo=0 and g.maximo=1 and o.nome='FRAMBOESA' and o.preco=300 and o.disponivel) then raise exception 'Licor inválido: %',cup.nome; end if;
    if (select count(*) from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Gelo de sabor' and g.minimo=1 and g.maximo=1 and o.preco=0 and o.quantidade_consumo=1 and o.componente_id is not null)<>5 then raise exception 'Gelo inválido: %',cup.nome; end if;
    if exists(select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Energético' and (o.quantidade_consumo<>400 or o.componente_id is null or o.preco<>case when cup.preco<2000 and o.nome like 'BALY %' then 300 else 0 end or (cup.preco>=2000 and o.nome not like 'BALY %'))) then raise exception 'Energetico inválido: %',cup.nome; end if;
    if (select count(*) from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id where g.produto_id=cup.id and g.nome='Energético')<>(case when cup.preco>=2000 then 7 else 12 end) then raise exception 'Quantidade energético inválida: %',cup.nome; end if;
  end loop;
end;
$teste$;
do $$ begin if (select jsonb_agg(to_jsonb(o) order by id) from public.opcoes o) is distinct from current_setting('qa.opcoes_repeat')::jsonb then raise exception 'Segunda execução alterou opções.';end if;end;$$;
rollback;

