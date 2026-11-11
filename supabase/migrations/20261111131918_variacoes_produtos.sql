alter table public.produtos
  add column familia_id uuid,
  add column familia_nome text,
  add column variacao_atributo text,
  add column variacao_nome text,
  add constraint produtos_variacao_campos check (
    (familia_id is null and familia_nome is null and variacao_atributo is null and variacao_nome is null)
    or (familia_id is not null and familia_nome is not null and char_length(btrim(familia_nome)) between 1 and 60
      and variacao_atributo is not null and char_length(btrim(variacao_atributo)) between 1 and 30
      and variacao_nome is not null and char_length(btrim(variacao_nome)) between 1 and 35 and not eh_kit));
create unique index produtos_variacao_unica on public.produtos(familia_id,lower(btrim(variacao_nome))) where familia_id is not null;

-- Every variation is an ordinary sellable SKU: orders, recipes and stock ledger
-- keep referring to its original product ID. There is no sellable parent SKU.
create function public.salvar_produto_variacoes(p_familia uuid,p_dados jsonb,p_atributo text,p_variacoes jsonb)
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
