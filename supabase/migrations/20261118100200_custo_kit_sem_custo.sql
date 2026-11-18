-- Custo do kit: quando nenhum componente tem custo cadastrado, o custo é
-- desconhecido ("—"), não R$ 0,00. Com parte dos custos, mostra o valor e avisa
-- quais faltam.

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
  , conhecido as (
    -- Algum componente com custo? Sem nenhum, o custo é "não sei" (null), não R$ 0,00
    select exists (select 1 from fixos where unitario is not null)
        or exists (select 1 from escolhas where nome is not null and not falta) as sim
  )
  select jsonb_build_object(
    'tem_componentes', exists (select 1 from fixos) or exists (select 1 from escolhas where nome is not null),
    'minimo', case when (select sim from conhecido) then
                round(coalesce((select sum(quantidade * unitario) from fixos), 0)
                      + coalesce((select sum(custo) from ordenadas where barata <= minimo), 0))::integer end,
    'maximo', case when (select sim from conhecido) then
                round(coalesce((select sum(quantidade * unitario) from fixos), 0)
                      + coalesce((select sum(custo) from ordenadas where cara <= minimo), 0))::integer end,
    'faltam', coalesce((select jsonb_agg(distinct nome) from (
                select nome from fixos where unitario is null
                union select nome from escolhas where falta) x), '[]'::jsonb)
  );
$$;
revoke all on function privado.custo_kit(uuid, jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
