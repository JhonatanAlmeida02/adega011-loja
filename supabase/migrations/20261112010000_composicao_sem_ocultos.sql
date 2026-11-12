-- "Vem no kit": itens marcados como Oculto (produto não visível na loja,
-- ex.: tampa, canudo) deixam de aparecer na vitrine. As escolhas ligadas a
-- produtos continuam todas, porque o cliente precisa delas para escolher.
create or replace function public.composicao_vitrine()
returns table (tipo text, dono_id uuid, nome text, foto_url text, quantidade integer)
language sql
stable
security definer
set search_path = ''
as $$
  with itens as (
    select 'kit'::text tipo, k.kit_id dono_id, c.id componente_id, c.nome,
           case when c.unidade_estoque = 'un' then k.quantidade end quantidade
      from public.kit_componentes k
      join public.produtos kit on kit.id = k.kit_id and kit.ativo
      join public.produtos c on c.id = k.componente_id and c.ativo  -- itens ocultos não aparecem
    union all
    select 'opcao', o.id, c.id, c.nome, null::integer
      from public.opcoes o
      join public.grupos_opcoes g on g.id = o.grupo_id
      join public.produtos dono on dono.id = g.produto_id and dono.ativo
      join public.produtos c on c.id = o.componente_id
  )
  select i.tipo, i.dono_id, i.nome,
         coalesce(c.foto_url, (select f.foto_url from public.produtos f
                                where c.familia_id is not null and f.familia_id = c.familia_id and f.foto_url is not null
                                order by f.ordem, f.nome limit 1)),
         i.quantidade
    from itens i
    join public.produtos c on c.id = i.componente_id
   order by i.tipo, i.dono_id, i.nome;
$$;

revoke all on function public.composicao_vitrine() from public;
grant execute on function public.composicao_vitrine() to anon, authenticated;
