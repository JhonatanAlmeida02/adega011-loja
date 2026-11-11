begin;
set local statement_timeout='25s';
do $$
declare vodka uuid:=gen_random_uuid(); longnight uuid:=gen_random_uuid(); baly uuid:=gen_random_uuid(); kit uuid:=gen_random_uuid(); kitfixo uuid:=gen_random_uuid(); gv uuid:=gen_random_uuid(); ge uuid:=gen_random_uuid();
  ov uuid:=gen_random_uuid(); ol uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid(); pedido uuid; r jsonb; admin_id uuid; antes integer;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.configuracoes set status_manual='aberta',aceita_retirada=true,pedido_minimo=0,pagamentos=array['pix','dinheiro','cartao'] where id=1;
  insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,volume_unidade) values(vodka,'QA bebida',2200,true,'ml',900),(longnight,'QA energético zero',1000,true,'ml',2000),(baly,'QA energético extra',1500,true,'ml',2000);
  insert into public.produtos(id,nome,preco,eh_kit) values(kit,'QA copão montável',1000,true),(kitfixo,'QA copão fixo',1000,true);
  perform public.ajustar_estoque(vodka,'entrada',900);
  perform public.ajustar_estoque(longnight,'entrada',240);
  perform public.ajustar_estoque(baly,'entrada',120);
  insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo) values(gv,kit,'Bebida',1,1),(ge,kit,'Energético',1,1);
  insert into public.opcoes(id,grupo_id,nome,preco,componente_id,quantidade_consumo) values(ov,gv,'Vodka',0,vodka,100),(ol,ge,'Long Night',0,longnight,120),(ob,ge,'Baly',300,baly,120);
  -- Saving a configured option-only kit is valid; an empty unconfigured kit stays blocked.
  perform public.salvar_produto_com_kit(kit,'{"nome":"QA copão montável","preco":1000,"eh_kit":true}','[]');
  begin
    perform public.salvar_produto_com_kit(gen_random_uuid(),'{"nome":"QA kit vazio","preco":1000,"eh_kit":true}','[]');
    raise exception using errcode='XX000',message='FAIL unconfigured empty kit accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select saldo from public.saldos_venda() where produto_id=kit)<>2 then raise exception 'FAIL dynamic availability';end if;
  if (select saldo from public.saldos_opcoes() where opcao_id=ob)<>1 then raise exception 'FAIL option balance';end if;
  begin
    update public.opcoes set quantidade_consumo=null where id=ob;
    raise exception using errcode='XX000',message='FAIL null ingredient consumption accepted';
  exception when check_violation then null;end;
  begin
    update public.produtos set controla_estoque=false where id=baly;
    raise exception using errcode='XX000',message='FAIL ingredient tracking disabled';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform privado.montar_itens(jsonb_build_array(jsonb_build_object('produto_id',kit,'quantidade',1,'opcoes',jsonb_build_array(ov))));
    raise exception using errcode='XX000',message='FAIL mandatory energetic omitted';
  exception when sqlstate 'P0001' then null;end;
  r:=public.criar_pedido('QA copão','11999123901','retirada',null,null,'pix',null,null,jsonb_build_array(jsonb_build_object('produto_id',kit,'quantidade',1,'opcoes',jsonb_build_array(ov,ob))));
  pedido:=(r->>'id')::uuid;
  if (r->>'total')::integer<>1300 or (select estoque from public.produtos where id=vodka)<>800 or (select estoque from public.produtos where id=baly)<>0 or (select estoque from public.produtos where id=longnight)<>240 then raise exception 'FAIL chosen Baly consumption/pricing';end if;
  select count(*) into antes from public.pedidos;
  begin
    perform public.criar_pedido('QA falta','11999123902','retirada',null,null,'pix',null,null,jsonb_build_array(jsonb_build_object('produto_id',kit,'quantidade',1,'opcoes',jsonb_build_array(ov,ob))));
    raise exception using errcode='XX000',message='FAIL exhausted choice accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select estoque from public.produtos where id=vodka)<>800 or (select count(*) from public.pedidos)<>antes then raise exception 'FAIL atomic stock shortage';end if;
  update public.opcoes set quantidade_consumo=60 where id=ob;
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=baly)<>120 or (select estoque from public.produtos where id=vodka)<>900 then raise exception 'FAIL refund used edited recipe';end if;
  update public.opcoes set quantidade_consumo=120 where id=ob;
  if privado.caixa_aberto() is null then perform public.abrir_caixa(0);end if;
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',kit,'quantidade',2,'opcoes',jsonb_build_array(ov,ol))),'pix');
  if (r->>'total')::integer<>2000 or (select estoque from public.produtos where id=longnight)<>0 or (select estoque from public.produtos where id=vodka)<>700 then raise exception 'FAIL PDV Long Night consumption/pricing';end if;
  if (select saldo from public.saldos_opcoes() where opcao_id=ol)<>0 then raise exception 'FAIL empty option stays available';end if;
  -- Fixed and chosen quantities using the same ingredient are added together.
  perform public.salvar_composicao_kit(kitfixo,jsonb_build_array(jsonb_build_object('componente_id',vodka,'quantidade',100)));
  insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo) values(gen_random_uuid(),kitfixo,'Extra',0,1) returning id into ge;
  insert into public.opcoes(id,grupo_id,nome,componente_id,quantidade_consumo) values(gen_random_uuid(),ge,'Dose extra',vodka,100) returning id into ov;
  r:=privado.consumo_itens(jsonb_build_array(jsonb_build_object('produto_id',kitfixo,'quantidade',2,'opcoes',jsonb_build_array(ov))));
  if (r->0->>'quantidade')::integer<>400 then raise exception 'FAIL shared fixed/chosen ingredient';end if;
end;$$;
rollback;
select 'PASS: choices, exact ml, zero and +3 pricing, site, PDV, insufficient stock rollback, cancellation snapshot and shared ingredients. Fixtures rolled back.' as resultado;
