-- Ajuste de cadastros solicitado em 18/11/2026. Idempotente, sem alterar estoque,
-- fotos, preço de venda, composição fixa, códigos existentes ou histórico de vendas.
-- Para ensaiar, executar com BEGIN e ROLLBACK ao redor deste arquivo.
do $$
declare
  copo record;
  item record;
  familia record;
  tipo text;
  grupo uuid;
  opcao uuid;
  prefixo text;
  codigo_novo text;
  proximo integer;
  contador integer;
  baly jsonb;
  long_night jsonb;
  gelo jsonb;
  lista jsonb;
  modelo jsonb;
  copos uuid[];
  codigos_antes jsonb;
  pais_antes jsonb;
begin
  perform pg_advisory_xact_lock(11011011);
  lock table public.produtos,public.produto_importacao,public.grupos_opcoes,public.opcoes in share row exclusive mode;
  select array_agg(id) into copos from public.produtos where eh_kit and (nome ilike 'COPÃO %' or nome ilike 'COPAO %');
  if coalesce(cardinality(copos),0)=0 then raise exception 'Nenhum copão encontrado.'; end if;
  select jsonb_object_agg(produto_id,codigo) into codigos_antes from public.produto_importacao where nullif(btrim(codigo),'') is not null;
  select jsonb_object_agg(produto_id,codigo_pai) into pais_antes from public.produto_importacao where nullif(btrim(codigo_pai),'') is not null;
  select jsonb_agg(jsonb_build_object('componente_id',id,'nome','BALY · '||variacao_nome,'consumo',400) order by variacao_nome)
    into baly from public.produtos where ativo and not eh_kit and volume_unidade=2000 and unidade_estoque='ml'
    and upper(nome) like 'ENERGÉTICO BALY 2 LITROS%';
  select jsonb_agg(jsonb_build_object('componente_id',id,'nome','LONG NIGHT · '||variacao_nome,'consumo',400) order by variacao_nome)
    into long_night from public.produtos where ativo and not eh_kit and volume_unidade=2000 and unidade_estoque='ml'
    and upper(nome) like 'ENERGÉTICO LONG NIGHT 2 LITROS%';
  select jsonb_agg(jsonb_build_object('componente_id',id,'nome',variacao_nome,'consumo',1) order by variacao_nome)
    into gelo from public.produtos where ativo and not eh_kit and unidade_estoque='un' and familia_nome='GELO DE SABOR 200ML';
  -- O adicional de licor já cadastrado não define consumo de estoque: manter
  -- essa configuração até que a dose/unidade seja registrada pelo usuário.
  select to_jsonb(o) into modelo from public.opcoes o join public.grupos_opcoes g on g.id=o.grupo_id
    where g.produto_id=any(copos) and lower(g.nome)='licor' and lower(o.nome) like '%framboesa%' and o.preco=300
    order by o.criado_em,o.id limit 1;
  if baly is null or long_night is null or gelo is null or modelo is null then raise exception 'Faltam os cadastros de referência.'; end if;

  for copo in select id,preco from public.produtos where id=any(copos) order by nome loop
    foreach tipo in array array['Energético','Gelo de sabor','Licor'] loop
      select id into grupo from public.grupos_opcoes where produto_id=copo.id and lower(nome)=lower(tipo) order by ordem,id limit 1;
      if grupo is null then
        insert into public.grupos_opcoes(produto_id,nome,minimo,maximo,ordem)
          values(copo.id,tipo,case when tipo='Licor' then 0 else 1 end,1,
            (select coalesce(max(ordem),-1)+1 from public.grupos_opcoes where produto_id=copo.id)) returning id into grupo;
      end if;
      update public.grupos_opcoes set minimo=case when tipo='Licor' then 0 else 1 end,maximo=1 where id=grupo;
      if tipo='Licor' then
        select id into opcao from public.opcoes where grupo_id=grupo and lower(nome) like '%framboesa%' order by ordem,id limit 1;
        if opcao is null then
          insert into public.opcoes(grupo_id,nome,preco,disponivel,ordem,componente_id,quantidade_consumo)
            values(grupo,'FRAMBOESA',300,true,0,(modelo->>'componente_id')::uuid,(modelo->>'quantidade_consumo')::integer);
        else
          update public.opcoes set nome='FRAMBOESA',preco=300,disponivel=true where id=opcao;
        end if;
        continue;
      end if;
      lista := case when tipo='Gelo de sabor' then gelo when copo.preco>=2000 then baly else long_night||baly end;
      if tipo='Energético' then
        -- Nos premium, Long Night sai da seleção. Apenas BALY está incluso.
        delete from public.opcoes o where grupo_id=grupo and not exists(
          select 1 from jsonb_array_elements(lista)e where (e->>'componente_id')::uuid=o.componente_id);
      end if;
      contador := 0;
      for item in select value as dados from jsonb_array_elements(lista) loop
        select id into opcao from public.opcoes where grupo_id=grupo and componente_id=(item.dados->>'componente_id')::uuid order by ordem,id limit 1;
        if opcao is null then
          insert into public.opcoes(grupo_id,nome,preco,disponivel,ordem,componente_id,quantidade_consumo)
            values(grupo,item.dados->>'nome',0,true,contador,(item.dados->>'componente_id')::uuid,(item.dados->>'consumo')::integer) returning id into opcao;
        end if;
        update public.opcoes set nome=item.dados->>'nome',
          preco=case when tipo='Energético' and copo.preco<2000 and item.dados->>'nome' like 'BALY %' then 300 else 0 end,
          quantidade_consumo=(item.dados->>'consumo')::integer,disponivel=true,ordem=contador where id=opcao;
        contador := contador+1;
      end loop;
    end loop;
  end loop;
  -- Monster é um extra legado. Não força um adicional de R$ 12 no copo básico.
  update public.grupos_opcoes g set minimo=0 where g.produto_id=any(copos) and lower(g.nome)='adicionais'
    and exists(select 1 from public.opcoes o where o.grupo_id=g.id and lower(o.nome)='monster');

  -- Só preencher códigos vazios, continuando cada prefixo sem reutilizar números.
  for item in select p.id,p.nome,c.nome as categoria from public.produtos p
    left join public.produto_importacao i on i.produto_id=p.id left join public.categorias c on c.id=p.categoria_id
    where nullif(btrim(i.codigo),'') is null order by p.nome,p.id
  loop
    prefixo := case item.categoria when 'Copões' then 'CP' when 'Ice' then 'IC' when 'Salgadinhos' then 'SG' end;
    if prefixo is null then raise exception 'Defina a sequência da categoria % antes de cadastrar SKU de %.',item.categoria,item.nome; end if;
    select coalesce(max(substring(upper(codigo) from length(prefixo)+1)::integer),0)+1 into proximo
      from public.produto_importacao where upper(codigo) ~ ('^'||prefixo||'[0-9]+$');
    codigo_novo := prefixo||lpad(proximo::text,greatest(3,length(proximo::text)),'0');
    insert into public.produto_importacao(produto_id,codigo,origem) values(item.id,codigo_novo,'{"fonte":"padronizacao_20261118"}')
      on conflict(produto_id) do update set codigo=excluded.codigo where nullif(btrim(produto_importacao.codigo),'') is null;
  end loop;
  for familia in select p.familia_id,min(p.familia_nome) as nome,max(nullif(btrim(i.codigo_pai),'')) as codigo_pai
    from public.produtos p left join public.produto_importacao i on i.produto_id=p.id where p.familia_id is not null
    group by p.familia_id having bool_or(nullif(btrim(i.codigo_pai),'') is null) order by min(p.familia_nome),p.familia_id
  loop
    codigo_novo := familia.codigo_pai;
    if codigo_novo is null then
      select coalesce(max(substring(upper(codigo) from 2)::integer),0)+1 into proximo
        from (select codigo from public.produto_importacao union all select codigo_pai from public.produto_importacao)i
        where upper(codigo) ~ '^P[0-9]+$';
      codigo_novo := 'P'||lpad(proximo::text,greatest(3,length(proximo::text)),'0');
    end if;
    update public.produto_importacao i set codigo_pai=codigo_novo from public.produtos p
      where i.produto_id=p.id and p.familia_id=familia.familia_id and nullif(btrim(i.codigo_pai),'') is null;
  end loop;
  if exists(select 1 from jsonb_each_text(codigos_antes)e left join public.produto_importacao i on i.produto_id=e.key::uuid where i.codigo is distinct from e.value)
    or exists(select 1 from jsonb_each_text(pais_antes)e left join public.produto_importacao i on i.produto_id=e.key::uuid where i.codigo_pai is distinct from e.value)
    then raise exception 'Um SKU existente foi alterado. Operação desfeita.'; end if;
  if exists(select 1 from public.produto_importacao group by lower(codigo) having count(*)>1 and lower(codigo) is not null) then
    raise exception 'SKU duplicado. Operação desfeita.'; end if;
end;
$$;
