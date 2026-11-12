-- Fotos da composição na vitrine.
-- A receita dos kits (kit_componentes) continua só para administradores. Esta
-- função entrega à loja apenas o que o cliente precisa ver: nome e foto de cada
-- item do kit e de cada escolha ligada a um produto. A quantidade só aparece
-- em unidades (ex.: 15 latas); doses em ml não são expostas.
-- A foto vem do próprio item; se a variação não tiver foto, usa a de outra
-- variação do mesmo produto.
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
      join public.produtos c on c.id = k.componente_id
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
