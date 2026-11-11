-- Mensagem de falta de estoque na unidade de venda.
--
-- Antes, a conferência comparava "garrafas pedidas" com o saldo em ml e só
-- quem barrava o pedido era a baixa do estoque, com a mensagem
-- "Vodka 1L · saldo insuficiente: 1500 ml disponíveis." (e, em kits, com o
-- nome do componente). Agora o pedido confere tudo o que consome antes de
-- gravar e responde "Vodka 1L · só temos 1 em estoque.". Nada muda no que é
-- vendido ou baixado: a baixa continua sendo feita por privado.baixar_estoque.

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
  v_falta record;
  v_venda record;
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

  -- Estoque: confere tudo o que o pedido consome de uma vez (produto avulso,
  -- garrafa em ml, pacote completo e componentes de kit, somando as linhas).
  -- A mensagem fala na unidade de venda do item do carrinho ("só temos 1"),
  -- nunca em ml ou no nome do componente do kit.
  for v_falta in
    select c.produto_id, c.quantidade, p.estoque
      from jsonb_to_recordset(privado.consumo_itens(v_itens)) as c(produto_id uuid, quantidade bigint)
      join public.produtos p on p.id = c.produto_id
     where c.quantidade > p.estoque
     order by c.produto_id
     limit 1
  loop
    -- Item do carrinho que usa esse estoque e quanto dele ainda dá para vender
    select pr.nome, i.qtd,
           floor(greatest(v_falta.estoque, 0)::numeric / case when pr.eh_kit then k.quantidade else pr.volume_unidade end)::integer as cabe
      into v_venda
      from (select (e ->> 'produto_id')::uuid as id, sum((e ->> 'quantidade')::integer) as qtd
              from jsonb_array_elements(v_itens) e group by 1) i
      join public.produtos pr on pr.id = i.id
      left join public.kit_componentes k on k.kit_id = pr.id and k.componente_id = v_falta.produto_id
     where (pr.eh_kit and k.componente_id is not null) or (not pr.eh_kit and pr.id = v_falta.produto_id)
     order by pr.nome
     limit 1;

    if not found then
      raise exception 'Um dos produtos do carrinho acabou. Atualize a página e tente de novo.';
    elsif v_venda.cabe <= 0 then
      raise exception '% está esgotado.', v_venda.nome;
    elsif v_venda.cabe >= v_venda.qtd then
      -- Sozinho o item cabe; falta porque outro item do pedido usa o mesmo estoque
      raise exception 'Não temos estoque para todos esses itens juntos (% e outro item usam o mesmo produto). Diminua a quantidade.', v_venda.nome;
    else
      raise exception '% · só temos % em estoque.', v_venda.nome, v_venda.cabe;
    end if;
  end loop;

  return jsonb_build_object('itens', v_itens, 'subtotal', v_subtotal);
end;
$$;

revoke all on function privado.montar_itens(jsonb) from public, anon, authenticated;
