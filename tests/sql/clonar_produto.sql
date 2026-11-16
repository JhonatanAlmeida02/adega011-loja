-- Executar em banco de testes ou com rollback; nenhum saldo real é alterado.
begin;
do $$
declare
  admin_id uuid := (select user_id from public.admins limit 1);
  simples uuid := gen_random_uuid();
  kit uuid := gen_random_uuid();
  grupo uuid := gen_random_uuid();
  familia uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  copia uuid := gen_random_uuid();
  copia_kit uuid := gen_random_uuid();
  copia_familia uuid := gen_random_uuid();
  copia_variacao uuid := gen_random_uuid();
  master uuid;
  copia_master uuid := gen_random_uuid();
  antes jsonb;
  nova_familia uuid;
begin
  if admin_id is null then raise exception 'Teste requer um administrador existente.'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  insert into public.produtos(id,nome,preco,controla_estoque,estoque,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote,foto_url)
    values(simples,'QA SIMPLES',2200,true,9000,'ml',900,1,false,'https://example.com/original.webp');
  insert into public.produto_importacao(produto_id,codigo,custo,origem) values(simples,'QA-CLONE-SIMPLES',1000,'{}');
  perform public.clonar_produto(simples,copia,true,jsonb_build_object(simples,'https://example.com/copia.webp'));
  if not exists(select 1 from public.produtos where id=copia and nome='QA SIMPLES (CÓPIA)'
    and estoque=0 and not ativo and volume_unidade=900 and controla_estoque
    and preco=2200 and foto_url='https://example.com/copia.webp') then raise exception 'Cópia simples inválida.'; end if;
  if not exists(select 1 from public.produto_importacao where produto_id=copia and codigo is null and custo=1000) then
    raise exception 'Custo ou SKU simples inválido.'; end if;
  perform public.clonar_produto(simples,copia);
  if (select count(*) from public.produto_importacao where origem->>'clonagem'=copia::text)<>1 then raise exception 'Retry duplicou cadastro.'; end if;
  begin
    perform public.clonar_produto(copia,copia);
    raise exception 'Deveria rejeitar UUID ocupado.';
  exception when raise_exception then
    if sqlerrm='Deveria rejeitar UUID ocupado.' then raise; end if;
  end;
  insert into public.produtos(id,nome,preco,eh_kit) values(kit,'QA KIT',1500,true);
  insert into public.kit_componentes values(kit,simples,100);
  insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo,ordem) values(grupo,kit,'ENERGÉTICO',1,1,2);
  insert into public.opcoes(grupo_id,nome,preco,disponivel,ordem,componente_id,quantidade_consumo)
    values(grupo,'BALY',300,true,3,simples,400);
  perform public.clonar_produto(kit,copia_kit);
  if not exists(select 1 from public.kit_componentes where kit_id=copia_kit and componente_id=simples and quantidade=100)
    or not exists(select 1 from public.grupos_opcoes g join public.opcoes o on o.grupo_id=g.id
      where g.produto_id=copia_kit and g.id<>grupo and g.minimo=1 and g.maximo=1 and g.ordem=2
      and o.nome='BALY' and o.preco=300 and o.componente_id=simples and o.quantidade_consumo=400)
    then raise exception 'Composição ou escolhas não foram copiadas.'; end if;
  update public.opcoes set preco=500 where grupo_id in(select id from public.grupos_opcoes where produto_id=copia_kit);
  if (select preco from public.opcoes where grupo_id=grupo)<>300 then raise exception 'Editar cópia alterou original.'; end if;
  insert into public.produtos(id,nome,preco,familia_id,familia_nome,variacao_atributo,variacao_nome,controla_estoque,estoque)
    values(v1,'QA SKOL · 269ML',400,familia,'QA SKOL','TAMANHO','269ML',true,8),
          (v2,'QA SKOL · 350ML',500,familia,'QA SKOL','TAMANHO','350ML',true,9);
  insert into public.produto_importacao(produto_id,codigo,codigo_pai,custo,origem)
    values(v1,'QA-V1','QA-PAI',200,'{}'),(v2,'QA-V2','QA-PAI',300,'{}');
  perform public.clonar_produto(v1,copia_familia);
  select familia_id into nova_familia from public.produtos where id=copia_familia;
  if nova_familia is null or nova_familia=familia
    or (select count(*) from public.produtos where familia_id=nova_familia and estoque=0 and not ativo)<>2
    or (select count(*) from public.produto_importacao i join public.produtos p on p.id=i.produto_id
      where p.familia_id=nova_familia and i.codigo is null and i.codigo_pai is null and i.custo in(200,300))<>2
    then raise exception 'Família não foi copiada independentemente.'; end if;
  perform public.clonar_produto(v2,copia_variacao,false);
  if not exists(select 1 from public.produtos where id=copia_variacao and familia_id is null
    and nome='QA SKOL · 350ML (CÓPIA)' and estoque=0 and preco=500) then raise exception 'Variação individual inválida.'; end if;
  if (select estoque from public.produtos where id=simples)<>9000
    or (select estoque from public.produtos where id=v1)<>8 then raise exception 'Alterou saldo original.'; end if;

  -- Caso real solicitado: apenas dentro desta transação, descartado ao final.
  select produto_id into master from public.produto_importacao where codigo='CMB001';
  if master is not null then
    select to_jsonb(p) into antes from public.produtos p where id=master;
    perform public.clonar_produto(master,copia_master);
    if (select to_jsonb(p) from public.produtos p where id=master)<>antes then raise exception 'Alterou CMB001.'; end if;
    if (select count(*) from public.kit_componentes where kit_id=master)<>
       (select count(*) from public.kit_componentes where kit_id=copia_master)
      or (select count(*) from public.grupos_opcoes where produto_id=master)<>
         (select count(*) from public.grupos_opcoes where produto_id=copia_master)
      or (select count(*) from public.opcoes o join public.grupos_opcoes g on g.id=o.grupo_id where g.produto_id=master)<>
         (select count(*) from public.opcoes o join public.grupos_opcoes g on g.id=o.grupo_id where g.produto_id=copia_master)
      then raise exception 'Clone de CMB001 incompleto.'; end if;
  end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.clonar_produto(simples,gen_random_uuid());
    raise exception 'Permitiu não administrador.';
  exception when raise_exception then
    if sqlerrm='Permitiu não administrador.' then raise; end if;
  end;
  if has_function_privilege('anon','public.clonar_produto(uuid,uuid,boolean,jsonb)','execute') then raise exception 'Anon com acesso.'; end if;
end;
$$;
rollback;
