-- Relatório de vendas com lucro líquido.
--
-- Lucro líquido = faturamento − custo dos produtos vendidos − despesas pagas.
--
-- Custo dos produtos: custo cadastrado (produto_importacao.custo, por unidade
-- vendida) × quantidade. Kit sem custo próprio usa o custo dos componentes
-- (custo do componente ÷ volume_unidade × quantidade consumida), e escolhas que
-- consomem um componente somam o custo dele. É o custo ATUAL do cadastro.
-- Itens sem custo em lugar nenhum entram em "vendas_sem_custo" (o lucro deles
-- fica superestimado — a tela avisa).
--
-- Despesas: saídas do financeiro no período (inclui contas a pagar pagas), sem
-- as estornadas. A categoria "Fornecedores" fica de fora: compra de mercadoria
-- já entra pelo custo dos produtos vendidos, contar as duas seria em dobro.

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
               (select c.custo from public.produto_importacao c where c.produto_id = it.produto_id and c.custo is not null),
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
             coalesce((select sum(total) from despesas), 0)::bigint as despesas
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
      'lucro_liquido', t.faturamento - t.custo - t.despesas,
      'por_origem', coalesce((select jsonb_agg(jsonb_build_object('chave', origem, 'pedidos', n, 'total', tt) order by tt desc)
                               from (select origem, count(*) n, sum(total) tt from base group by origem) x), '[]'::jsonb),
      'por_pagamento', coalesce((select jsonb_agg(jsonb_build_object('chave', pagamento, 'pedidos', n, 'total', tt) order by tt desc)
                                  from (select pagamento, count(*) n, sum(total) tt from base group by pagamento) x), '[]'::jsonb),
      'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'pedidos', n, 'total', tt) order by dia)
                            from (select (criado_em at time zone 'America/Sao_Paulo')::date dia, count(*) n, sum(total) tt
                                    from base group by 1) x), '[]'::jsonb),
      'top_produtos', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', q, 'total', tt) order by q desc, tt desc)
                                 from (select nome, sum(qtd) q, sum(total) tt from itens group by nome order by q desc, tt desc limit 10) x), '[]'::jsonb)
    )
    from totais t
  );
end;
$$;

revoke all on function public.relatorio_vendas(date, date) from public, anon;
grant execute on function public.relatorio_vendas(date, date) to authenticated;
notify pgrst, 'reload schema';
