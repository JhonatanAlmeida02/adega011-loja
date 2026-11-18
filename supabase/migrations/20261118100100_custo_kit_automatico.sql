-- Custo do kit automático + tarifas no relatório.
--
-- Custo do kit = soma dos componentes (custo do componente ÷ volume_unidade ×
-- quantidade consumida). Escolhas obrigatórias (ex.: vodka do copão, sabor da
-- carteira) entram pela opção mais barata e pela mais cara: o kit mostra a faixa
-- "mínimo – máximo". Na venda, o relatório usa a escolha de verdade.
-- O custo manual de kits deixa de valer (é apagado aqui e ignorado no relatório).
--
-- Relatório: as tarifas (maquininha e Pix) saem do lucro líquido.

/** Custo de um kit a partir de uma composição (a salva ou a que está sendo editada). */
create or replace function privado.custo_kit(p_produto uuid, p_componentes jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.id, p.nome, c.custo::numeric / greatest(p.volume_unidade, 1) as unitario
      from public.produtos p left join public.produto_importacao c on c.produto_id = p.id
  ),
  fixos as (
    select b.nome, b.unitario, (e ->> 'quantidade')::numeric as quantidade
      from jsonb_array_elements(case when jsonb_typeof(p_componentes) = 'array' then p_componentes else '[]'::jsonb end) e
      join base b on b.id = (case when e ->> 'componente_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                  then (e ->> 'componente_id')::uuid end)
     where jsonb_typeof(e -> 'quantidade') = 'number' and (e ->> 'quantidade')::numeric between 1 and 1000000
  ),
  escolhas as (
    select g.id as grupo, g.minimo, b.nome,
           case when o.componente_id is null then 0 else o.quantidade_consumo * b.unitario end as custo,
           (o.componente_id is not null and b.unitario is null) as falta
      from public.grupos_opcoes g
      join public.opcoes o on o.grupo_id = g.id and o.disponivel
      left join base b on b.id = o.componente_id
     where g.produto_id = p_produto and g.minimo > 0
  ),
  ordenadas as (
    select *, row_number() over (partition by grupo order by custo asc nulls last) as barata,
              row_number() over (partition by grupo order by custo desc nulls last) as cara
      from escolhas
  )
  select jsonb_build_object(
    'tem_componentes', exists (select 1 from fixos) or exists (select 1 from escolhas where nome is not null),
    'minimo', round(coalesce((select sum(quantidade * unitario) from fixos), 0)
                    + coalesce((select sum(custo) from ordenadas where barata <= minimo), 0))::integer,
    'maximo', round(coalesce((select sum(quantidade * unitario) from fixos), 0)
                    + coalesce((select sum(custo) from ordenadas where cara <= minimo), 0))::integer,
    'faltam', coalesce((select jsonb_agg(distinct nome) from (
                select nome from fixos where unitario is null
                union select nome from escolhas where falta) x), '[]'::jsonb)
  );
$$;
revoke all on function privado.custo_kit(uuid, jsonb) from public, anon, authenticated;

/** Custo automático de todos os kits (tabela de produtos). */
create or replace function public.custos_kits()
returns table (produto_id uuid, custo_min integer, custo_max integer, faltam jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
    select p.id,
           case when (r ->> 'tem_componentes')::boolean then (r ->> 'minimo')::integer end,
           case when (r ->> 'tem_componentes')::boolean then (r ->> 'maximo')::integer end,
           r -> 'faltam'
      from public.produtos p
      cross join lateral (
        select privado.custo_kit(p.id, coalesce((
          select jsonb_agg(jsonb_build_object('componente_id', k.componente_id, 'quantidade', k.quantidade))
            from public.kit_componentes k where k.kit_id = p.id), '[]'::jsonb)) as r
      ) x
     where p.eh_kit;
end;
$$;

/** Prévia no cadastro: custo do kit com a composição que está na tela. */
create or replace function public.custo_kit_previa(p_produto uuid, p_componentes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if jsonb_typeof(p_componentes) <> 'array' or jsonb_array_length(p_componentes) > 200 then
    raise exception 'Composição inválida.';
  end if;
  return privado.custo_kit(p_produto, p_componentes);
end;
$$;

revoke all on function public.custos_kits() from public, anon;
revoke all on function public.custo_kit_previa(uuid, jsonb) from public, anon;
grant execute on function public.custos_kits() to authenticated;
grant execute on function public.custo_kit_previa(uuid, jsonb) to authenticated;

-- Custo digitado à mão em kit não vale mais (agora é automático)
update public.produto_importacao c set custo = null
  from public.produtos p where p.id = c.produto_id and p.eh_kit and c.custo is not null;

create or replace function public.relatorio_vendas(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de timestamptz := (p_inicio::timestamp at time zone 'America/Sao_Paulo');
  v_ate timestamptz := ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform privado.exigir_admin();
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 366 then
    raise exception 'Período inválido.';
  end if;

  return (
    with base as (
      select * from public.pedidos
       where criado_em >= v_de and criado_em < v_ate and status <> 'cancelado'
    ),
    itens as (
      select i ->> 'nome' as nome,
             (i ->> 'produto_id')::uuid as produto_id,
             (i ->> 'quantidade')::integer as qtd,
             (i ->> 'preco')::integer * (i ->> 'quantidade')::integer as total,
             case when jsonb_typeof(i -> 'opcoes') = 'array' then i -> 'opcoes' else '[]'::jsonb end as opcoes
        from base, jsonb_array_elements(base.itens) i
    ),
    -- Custo de uma unidade base (un ou ml) de cada produto
    custo_base as (
      select p.id, c.custo::numeric / p.volume_unidade as unitario
        from public.produtos p join public.produto_importacao c on c.produto_id = p.id
       where c.custo is not null
    ),
    custos as (
      select it.*,
             coalesce(
               -- Kit: sempre a soma dos componentes (custo automático)
               (select c.custo from public.produto_importacao c join public.produtos p on p.id = c.produto_id
                 where c.produto_id = it.produto_id and c.custo is not null and not p.eh_kit),
               (select sum(k.quantidade * cb.unitario)
                  from public.kit_componentes k join custo_base cb on cb.id = k.componente_id
                 where k.kit_id = it.produto_id)
             ) as custo_proprio,
             (select sum(o.quantidade_consumo * cb.unitario)
                from jsonb_array_elements(it.opcoes) e
                join public.opcoes o on o.id = (case when jsonb_typeof(e) = 'object' then e ->> 'id' else e #>> '{}' end)::uuid
                join custo_base cb on cb.id = o.componente_id) as custo_opcoes
        from itens it
    ),
    produtos_vendidos as (
      select coalesce(round(sum(qtd * (coalesce(custo_proprio, 0) + coalesce(custo_opcoes, 0)))), 0)::bigint as custo,
             coalesce(sum(total) filter (where custo_proprio is null and custo_opcoes is null), 0)::bigint as sem_custo
        from custos
    ),
    despesas as (
      select coalesce(nullif(btrim(l.categoria), ''), 'Sem categoria') as categoria, sum(l.valor)::bigint as total
        from public.financeiro_lancamentos l
       where l.tipo = 'saida' and l.data between p_inicio and p_fim
         and lower(btrim(l.categoria)) not like 'fornecedor%'
         and not exists (select 1 from public.financeiro_lancamentos e where e.estorno_de = l.id)
       group by 1
    ),
    totais as (
      select coalesce((select sum(total) from base), 0)::bigint as faturamento,
             (select custo from produtos_vendidos) as custo,
             (select sem_custo from produtos_vendidos) as sem_custo,
             coalesce((select sum(total) from despesas), 0)::bigint as despesas,
             coalesce((select sum(tarifa) from base where status = 'concluido'), 0)::bigint as tarifas
    )
    select jsonb_build_object(
      'faturamento', t.faturamento,
      'pedidos', (select count(*) from base),
      'ticket_medio', coalesce((select round(avg(total)) from base), 0),
      'descontos', coalesce((select sum(desconto) from base), 0),
      'taxas_entrega', coalesce((select sum(taxa) from base), 0),
      'cancelados', (select count(*) from public.pedidos
                      where criado_em >= v_de and criado_em < v_ate and status = 'cancelado'),
      'custo_produtos', t.custo,
      'vendas_sem_custo', t.sem_custo,
      'despesas', t.despesas,
      'despesas_por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'total', total) order by total desc) from despesas), '[]'::jsonb),
      'lucro_bruto', t.faturamento - t.custo,
      'tarifas', t.tarifas,
      'tarifas_por_forma', coalesce((select jsonb_agg(jsonb_build_object('chave', chave, 'pedidos', n, 'total', tt) order by tt desc)
                                      from (select coalesce(maquininha_nome, case when pagamento = 'pix' then 'Pix' else 'Cartão' end) chave,
                                                   count(*) n, sum(tarifa) tt
                                              from base where status = 'concluido' and tarifa > 0 group by 1) x), '[]'::jsonb),
      'lucro_liquido', t.faturamento - t.custo - t.tarifas - t.despesas,
      'por_origem', coalesce((select jsonb_agg(jsonb_build_object('chave', origem, 'pedidos', n, 'total', tt) order by tt desc)
                               from (select origem, count(*) n, sum(total) tt from base group by origem) x), '[]'::jsonb),
      'por_pagamento', coalesce((select jsonb_agg(jsonb_build_object('chave', pagamento, 'pedidos', n, 'total', tt) order by tt desc)
                                  from (select pagamento, count(*) n, sum(total) tt from base group by pagamento) x), '[]'::jsonb),
      'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'pedidos', n, 'total', tt) order by dia)
                            from (select (criado_em at time zone 'America/Sao_Paulo')::date dia, count(*) n, sum(total) tt
                                    from base group by 1) x), '[]'::jsonb),
      'top_produtos', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', q, 'total', tt, 'custo', custo) order by q desc, tt desc)
                                 from (
                                   select nome, sum(qtd) q, sum(total) tt,
                                     case when bool_or(custo_proprio is null and custo_opcoes is null) then null
                                       else round(sum(qtd * (coalesce(custo_proprio, 0) + coalesce(custo_opcoes, 0))))::bigint end as custo
                                   from custos group by nome order by q desc, tt desc limit 10
                                 ) x), '[]'::jsonb)
    )
    from totais t
  );
end;
$$;

revoke all on function public.relatorio_vendas(date, date) from public, anon;
grant execute on function public.relatorio_vendas(date, date) to authenticated;
notify pgrst, 'reload schema';
