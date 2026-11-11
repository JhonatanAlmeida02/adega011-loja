alter table public.produtos add column unidades_pacote integer not null default 1 check (unidades_pacote between 1 and 1000000);

-- Save the product and its recipe as one atomic operation. The browser assigns
-- an id before the first save so a network retry updates the same product.
create or replace function public.salvar_produto_com_kit(p_id uuid,p_dados jsonb,p_componentes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.produtos%rowtype; v_kit boolean; v_ordem integer; v_categoria uuid;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_id is null or p_dados is null or jsonb_typeof(p_dados)<>'object' then
    raise exception 'Cadastro inválido.';
  end if;
  v_kit:=coalesce((p_dados->>'eh_kit')::boolean,false);
  if v_kit and (p_componentes is null or jsonb_typeof(p_componentes)<>'array' or jsonb_array_length(p_componentes)=0) then
    raise exception 'Adicione pelo menos um componente ao kit.';
  end if;
  if coalesce(btrim(p_dados->>'nome'),'')='' then raise exception 'Informe o nome do produto.';end if;
  v_categoria:=nullif(p_dados->>'categoria_id','')::uuid;
  select * into v from public.produtos where id=p_id for update;
  if found then v_ordem:=v.ordem;
  else select coalesce(max(ordem),-1)+1 into v_ordem from public.produtos where categoria_id is not distinct from v_categoria;
  end if;
  -- Explicitly list writable fields; never accept stock balance from the client.
  insert into public.produtos(id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote)
  values(p_id,v_categoria,btrim(p_dados->>'nome'),coalesce(btrim(p_dados->>'descricao'),''),(p_dados->>'preco')::integer,
    nullif(p_dados->>'foto_url',''),coalesce((p_dados->>'destaque')::boolean,false),
    coalesce((p_dados->>'disponivel')::boolean,true),coalesce((p_dados->>'ativo')::boolean,true),v_ordem,
    not v_kit and coalesce((p_dados->>'controla_estoque')::boolean,false),v_kit,
    case when v_kit then 'un' else coalesce(p_dados->>'unidade_estoque','un') end,
    case when not v_kit and p_dados->>'unidade_estoque'='ml' then coalesce((p_dados->>'volume_unidade')::integer,1) else 1 end,
    case when v_kit then 1 else coalesce((p_dados->>'unidades_pacote')::integer,v.unidades_pacote,1) end)
  on conflict(id) do update set categoria_id=excluded.categoria_id,nome=excluded.nome,descricao=excluded.descricao,
    preco=excluded.preco,foto_url=excluded.foto_url,destaque=excluded.destaque,disponivel=excluded.disponivel,
    ativo=excluded.ativo,controla_estoque=excluded.controla_estoque,eh_kit=excluded.eh_kit,
    unidade_estoque=excluded.unidade_estoque,volume_unidade=excluded.volume_unidade,unidades_pacote=excluded.unidades_pacote
  returning * into v;
  if v_kit then perform public.salvar_composicao_kit(p_id,p_componentes);end if;
  return to_jsonb(v);
end;
$$;
revoke all on function public.salvar_produto_com_kit(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.salvar_produto_com_kit(uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';

create or replace function public.salvar_produto_variacoes(p_familia uuid,p_dados jsonb,p_atributo text,p_variacoes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare linha jsonb; sku uuid; nome_base text; valor text; ids uuid[]; resultado jsonb:='[]'; produto jsonb;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  nome_base:=btrim(p_dados->>'nome');
  p_atributo:=btrim(p_atributo);
  if p_familia is null or p_dados is null or jsonb_typeof(p_dados)<>'object'
    or nome_base is null or char_length(nome_base) not between 1 and 60
    or p_atributo is null or char_length(p_atributo) not between 1 and 30 then
    raise exception 'Informe o nome do produto e o tipo da variação.';
  end if;
  if coalesce((p_dados->>'eh_kit')::boolean,false) then raise exception 'Variações devem ser produtos simples. Selecione a variação desejada na composição do kit.';end if;
  if p_variacoes is null or jsonb_typeof(p_variacoes)<>'array' then raise exception 'Informe as variações.';end if;
  if jsonb_array_length(p_variacoes) not between 1 and 50 then raise exception 'Cadastre de 1 a 50 variações.';end if;
  select array_agg((e->>'id')::uuid) into ids from jsonb_array_elements(p_variacoes)e;
  if exists(select 1 from unnest(ids) id where id is null) or cardinality(ids)<>(select count(distinct id) from unnest(ids)id) then
    raise exception 'Identificadores de variações inválidos.';
  end if;
  if exists(select 1 from public.produtos p where p.familia_id=p_familia and not(p.id=any(ids))) then
    raise exception 'O cadastro mudou. Reabra o produto para carregar todas as variações. Para retirar uma opção, desative sua visibilidade.';
  end if;
  if exists(select 1 from public.produtos p where p.id=any(ids) and p.familia_id is not null and p.familia_id<>p_familia) then
    raise exception 'Uma das variações já pertence a outro produto.';
  end if;
  if exists(select 1 from public.produtos p where p.id=any(ids) and p.eh_kit) then
    raise exception 'Um kit existente não pode ser convertido em variação. Cadastre um produto simples separado.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_variacoes)e group by lower(btrim(e->>'nome')) having count(*)>1) then
    raise exception 'Há variações com o mesmo nome.';
  end if;
  -- Clear labels inside the transaction so two existing labels can be swapped.
  update public.produtos set familia_id=null,familia_nome=null,variacao_atributo=null,variacao_nome=null where familia_id=p_familia;
  for linha in select * from jsonb_array_elements(p_variacoes) loop
    sku:=(linha->>'id')::uuid; valor:=btrim(linha->>'nome');
    if valor is null or char_length(valor) not between 1 and 35 then raise exception 'Informe o nome de cada variação (até 35 caracteres).';end if;
    produto:=public.salvar_produto_com_kit(sku,p_dados || jsonb_build_object(
      'nome',nome_base || ' · ' || valor,'preco',(linha->>'preco')::integer,
      'eh_kit',false,'controla_estoque',true,
      'volume_unidade',coalesce((linha->>'volume_unidade')::integer,1),
      'unidades_pacote',coalesce((linha->>'unidades_pacote')::integer,(p_dados->>'unidades_pacote')::integer,(select p.unidades_pacote from public.produtos p where p.id=sku),1),
      'ativo',coalesce((linha->>'ativo')::boolean,true),
      'disponivel',coalesce((linha->>'disponivel')::boolean,true)), '[]');
    update public.produtos set familia_id=p_familia,familia_nome=nome_base,variacao_atributo=p_atributo,variacao_nome=valor where id=sku;
    resultado:=resultado || jsonb_build_array(produto || jsonb_build_object('familia_id',p_familia,'familia_nome',nome_base,'variacao_atributo',p_atributo,'variacao_nome',valor));
  end loop;
  return resultado;
end;
$$;
revoke all on function public.salvar_produto_variacoes(uuid,jsonb,text,jsonb) from public,anon;
grant execute on function public.salvar_produto_variacoes(uuid,jsonb,text,jsonb) to authenticated;
notify pgrst,'reload schema';

-- Convert incoming packages under the same lock used by stock and sales.
-- Package size is independent of volume_unidade (the quantity consumed per sale).
create function public.registrar_entrada_estoque(
  p_produto uuid,p_quantidade integer,p_formato text,p_fator_esperado integer,p_observacao text default null
) returns integer language plpgsql security definer set search_path='' as $$
declare v public.produtos%rowtype; fator integer; total bigint; resumo text;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_quantidade is null or p_quantidade<1 or p_formato is null or p_formato not in ('base','pacote','garrafa') then
    raise exception 'Informe uma quantidade inteira positiva e um formato de entrada válido.';
  end if;
  select * into v from public.produtos where id=p_produto for update;
  if not found then raise exception 'Produto não encontrado.';end if;
  if v.eh_kit then raise exception 'Lance o estoque nos componentes do kit.';end if;
  if p_formato='pacote' then
    if v.unidade_estoque<>'un' or v.unidades_pacote<=1 then raise exception 'Configure as unidades por pacote no cadastro do produto.';end if;
    fator:=v.unidades_pacote;
  elsif p_formato='garrafa' then
    if v.unidade_estoque<>'ml' then raise exception 'Entrada em garrafas exige estoque em ml.';end if;
    fator:=v.volume_unidade;
  else fator:=1;
  end if;
  if p_fator_esperado is distinct from fator then raise exception 'A quantidade da embalagem mudou. Reabra a entrada para conferir a conversão.';end if;
  total:=p_quantidade::bigint*fator;
  if total>1000000000 then raise exception 'Quantidade convertida excede o limite.';end if;
  if p_formato<>'base' then
    resumo:=format('%s %s x %s %s = %s %s',p_quantidade,case when p_formato='pacote' then 'pacotes' else 'garrafas' end,fator,v.unidade_estoque,total,v.unidade_estoque);
  end if;
  return public.ajustar_estoque(p_produto,'entrada',total::integer,
    left(concat_ws(' · ',resumo,nullif(btrim(p_observacao),'')),200));
end;
$$;
revoke all on function public.registrar_entrada_estoque(uuid,integer,text,integer,text) from public,anon;
grant execute on function public.registrar_entrada_estoque(uuid,integer,text,integer,text) to authenticated;
notify pgrst,'reload schema';
