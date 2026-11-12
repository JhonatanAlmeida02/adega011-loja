-- SKU (código) no cadastro do produto e de cada variação.
--
-- O código já existia em public.produto_importacao, mas só vinha da planilha.
-- Agora o cadastro também grava: em produto simples/kit, p_dados.codigo; em
-- produto com variações, p_dados.codigo é o SKU do produto (codigo_pai) e cada
-- variação manda o seu em p_variacoes[].codigo. Sem a chave "codigo" nada muda
-- (clientes antigos continuam funcionando). Vazio apaga o SKU.

-- Uma variação pode ter só o SKU do produto (pai), sem código próprio.
alter table public.produto_importacao alter column codigo drop not null;

create or replace function privado.salvar_sku(p_produto uuid, p_codigo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_dono text;
begin
  if v_codigo is not null and char_length(v_codigo) > 100 then
    raise exception 'O SKU pode ter até 100 caracteres.';
  end if;
  if v_codigo is not null then
    select p.nome into v_dono
      from public.produto_importacao i join public.produtos p on p.id = i.produto_id
     where lower(i.codigo) = lower(v_codigo) and i.produto_id <> p_produto
     limit 1;
    if found then
      raise exception 'O SKU % já está em uso por "%".', v_codigo, v_dono;
    end if;
  end if;

  if exists (select 1 from public.produto_importacao where produto_id = p_produto) then
    update public.produto_importacao set codigo = v_codigo where produto_id = p_produto;
  elsif v_codigo is not null then
    insert into public.produto_importacao (produto_id, codigo, origem)
    values (p_produto, v_codigo, jsonb_build_object('fonte', 'cadastro'));
  end if;
end;
$$;

create or replace function privado.salvar_sku_pai(p_produtos uuid[], p_codigo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
begin
  if v_codigo is not null and char_length(v_codigo) > 100 then
    raise exception 'O SKU pode ter até 100 caracteres.';
  end if;
  update public.produto_importacao set codigo_pai = v_codigo where produto_id = any(p_produtos);
  if v_codigo is not null then
    insert into public.produto_importacao (produto_id, codigo, codigo_pai, origem)
    select id, null, v_codigo, jsonb_build_object('fonte', 'cadastro')
      from unnest(p_produtos) id
     where not exists (select 1 from public.produto_importacao i where i.produto_id = id);
  end if;
end;
$$;

revoke all on function privado.salvar_sku(uuid, text) from public, anon, authenticated;
revoke all on function privado.salvar_sku_pai(uuid[], text) from public, anon, authenticated;

create or replace function public.salvar_produto_com_kit(p_id uuid, p_dados jsonb, p_componentes jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v public.produtos%rowtype; v_kit boolean; v_ordem integer; v_categoria uuid;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_id is null or p_dados is null or jsonb_typeof(p_dados)<>'object' then
    raise exception 'Cadastro inválido.';
  end if;
  v_kit:=coalesce((p_dados->>'eh_kit')::boolean,false);
  if v_kit and (p_componentes is null or jsonb_typeof(p_componentes)<>'array') then
    raise exception 'Composição inválida.';
  end if;
  if v_kit and jsonb_array_length(p_componentes)=0 and not exists(
    select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id
    where g.produto_id=p_id and g.minimo>0 and o.componente_id is not null
  ) then
    raise exception 'Adicione pelo menos um componente ao kit.';
  end if;
  if coalesce(btrim(p_dados->>'nome'),'')='' then raise exception 'Informe o nome do produto.';end if;
  v_categoria:=nullif(p_dados->>'categoria_id','')::uuid;
  select * into v from public.produtos where id=p_id for update;
  if found then v_ordem:=v.ordem;
  else select coalesce(max(ordem),-1)+1 into v_ordem from public.produtos where categoria_id is not distinct from v_categoria;
  end if;
  -- Explicitly list writable fields; never accept stock balance from the client.
  insert into public.produtos(id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote)
  values(p_id,v_categoria,btrim(p_dados->>'nome'),coalesce(btrim(p_dados->>'descricao'),''),(p_dados->>'preco')::integer,
    nullif(p_dados->>'foto_url',''),coalesce((p_dados->>'destaque')::boolean,false),
    coalesce((p_dados->>'disponivel')::boolean,true),coalesce((p_dados->>'ativo')::boolean,true),v_ordem,
    not v_kit and coalesce((p_dados->>'controla_estoque')::boolean,false),v_kit,
    case when v_kit then 'un' else coalesce(p_dados->>'unidade_estoque','un') end,
    case when not v_kit and p_dados->>'unidade_estoque'='ml' then coalesce((p_dados->>'volume_unidade')::integer,1) else 1 end,
    case when v_kit then 1 else coalesce((p_dados->>'unidades_pacote')::integer,v.unidades_pacote,1) end,
    case when not v_kit and coalesce(p_dados->>'unidade_estoque','un')='un' then coalesce((p_dados->>'vende_pacote')::boolean,v.vende_pacote,false) else false end)
  on conflict(id) do update set categoria_id=excluded.categoria_id,nome=excluded.nome,descricao=excluded.descricao,
    preco=excluded.preco,foto_url=excluded.foto_url,destaque=excluded.destaque,disponivel=excluded.disponivel,
    ativo=excluded.ativo,preco_pendente=false,controla_estoque=excluded.controla_estoque,eh_kit=excluded.eh_kit,
    unidade_estoque=excluded.unidade_estoque,volume_unidade=excluded.volume_unidade,unidades_pacote=excluded.unidades_pacote,vende_pacote=excluded.vende_pacote
  returning * into v;
  if v_kit then perform public.salvar_composicao_kit(p_id,p_componentes);end if;
  if p_dados ? 'codigo' then perform privado.salvar_sku(p_id, p_dados->>'codigo');end if;
  return to_jsonb(v);
end;
$function$;

create or replace function public.salvar_produto_variacoes(p_familia uuid, p_dados jsonb, p_atributo text, p_variacoes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if exists(select 1 from jsonb_array_elements(p_variacoes)e where nullif(btrim(e->>'codigo'),'') is not null
            group by lower(btrim(e->>'codigo')) having count(*)>1) then
    raise exception 'Há variações com o mesmo SKU.';
  end if;
  -- Libera os SKUs das variações antes de regravar, para permitir trocar códigos entre elas.
  if exists(select 1 from jsonb_array_elements(p_variacoes)e where e ? 'codigo') then
    update public.produto_importacao set codigo=null
     where produto_id in (select (e->>'id')::uuid from jsonb_array_elements(p_variacoes)e where e ? 'codigo');
  end if;
  -- Clear labels inside the transaction so two existing labels can be swapped.
  update public.produtos set familia_id=null,familia_nome=null,variacao_atributo=null,variacao_nome=null where familia_id=p_familia;
  for linha in select * from jsonb_array_elements(p_variacoes) loop
    sku:=(linha->>'id')::uuid; valor:=btrim(linha->>'nome');
    if valor is null or char_length(valor) not between 1 and 35 then raise exception 'Informe o nome de cada variação (até 35 caracteres).';end if;
    -- O "codigo" de p_dados é o SKU do produto (pai); o da variação vem na linha.
    produto:=public.salvar_produto_com_kit(sku,(p_dados - 'codigo')
      || case when linha ? 'codigo' then jsonb_build_object('codigo',linha->'codigo') else '{}'::jsonb end
      || jsonb_build_object(
      'nome',nome_base || ' · ' || valor,'preco',(linha->>'preco')::integer,
      'eh_kit',false,'controla_estoque',coalesce((select p.controla_estoque from public.produtos p where p.id=sku),true),
      'foto_url',case when linha ? 'foto_url' then linha->>'foto_url'
        else coalesce((select p.foto_url from public.produtos p where p.id=sku),p_dados->>'foto_url') end,
      'volume_unidade',coalesce((linha->>'volume_unidade')::integer,1),
      'unidades_pacote',coalesce((linha->>'unidades_pacote')::integer,(p_dados->>'unidades_pacote')::integer,(select p.unidades_pacote from public.produtos p where p.id=sku),1),
      'ativo',coalesce((linha->>'ativo')::boolean,true),
      'disponivel',coalesce((linha->>'disponivel')::boolean,true)), '[]');
    update public.produtos set familia_id=p_familia,familia_nome=nome_base,variacao_atributo=p_atributo,variacao_nome=valor where id=sku;
    resultado:=resultado || jsonb_build_array(produto || jsonb_build_object('familia_id',p_familia,'familia_nome',nome_base,'variacao_atributo',p_atributo,'variacao_nome',valor));
  end loop;
  if p_dados ? 'codigo' then perform privado.salvar_sku_pai(ids, p_dados->>'codigo');end if;
  return resultado;
end;
$function$;

notify pgrst, 'reload schema';
