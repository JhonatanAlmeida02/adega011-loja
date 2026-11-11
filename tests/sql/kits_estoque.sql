begin;
set local statement_timeout='25s';
do $test$
declare
  lata uuid:=gen_random_uuid(); garrafa uuid:=gen_random_uuid(); fardo uuid:=gen_random_uuid(); copao uuid:=gen_random_uuid();
  pedido uuid; venda uuid; r jsonb; n integer; before_count integer; admin_id uuid;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.configuracoes set status_manual='aberta',aceita_retirada=true,pagamentos=array['pix','dinheiro','cartao'] where id=1;
  insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,volume_unidade) values
    (lata,'QA lata descartada',400,true,'un',1),(garrafa,'QA garrafa descartada',2200,true,'ml',900);
  insert into public.produtos(id,nome,preco,eh_kit) values(fardo,'QA fardo descartado',5000,true),(copao,'QA copão descartado',1000,true);
  perform public.ajustar_estoque(lata,'entrada',31);
  perform public.ajustar_estoque(garrafa,'entrada',900);
  perform public.salvar_composicao_kit(fardo,jsonb_build_array(jsonb_build_object('componente_id',lata,'quantidade',15)));
  perform public.salvar_composicao_kit(copao,jsonb_build_array(jsonb_build_object('componente_id',garrafa,'quantidade',100)));
  select saldo into n from public.saldos_venda() where produto_id=fardo;
  if n<>2 then raise exception 'FAIL expected 2 fardos, got %',n;end if;
  select saldo into n from public.saldos_venda() where produto_id=copao;
  if n<>9 then raise exception 'FAIL 900ml should make 9 cups';end if;
  select saldo into n from public.saldos_venda() where produto_id=garrafa;
  if n<>1 then raise exception 'FAIL bottle available count';end if;

  r:=public.criar_pedido('QA kit','11999123401','retirada',null,null,'pix',null,null,
    jsonb_build_array(jsonb_build_object('produto_id',fardo,'quantidade',1),jsonb_build_object('produto_id',lata,'quantidade',1)));
  pedido:=(r->>'id')::uuid;
  select estoque into n from public.produtos where id=lata;
  if n<>15 then raise exception 'FAIL fardo + lata should consume 16, remaining %',n;end if;
  select count(*) into before_count from public.pedidos;
  begin
    perform public.criar_pedido('QA shortage','11999123402','retirada',null,null,'pix',null,null,
      jsonb_build_array(jsonb_build_object('produto_id',fardo,'quantidade',1),jsonb_build_object('produto_id',lata,'quantidade',1)));
    raise exception using errcode='XX000',message='FAIL shortage accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select estoque from public.produtos where id=lata)<>15 or (select count(*) from public.pedidos)<>before_count then
    raise exception 'FAIL shortage did not roll back atomically';end if;
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=lata)<>31 then raise exception 'FAIL cancel fardo restore';end if;
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=lata)<>31 then raise exception 'FAIL duplicate cancel restore';end if;

  r:=public.criar_pedido('QA copão','11999123403','retirada',null,null,'pix',null,null,
    jsonb_build_array(jsonb_build_object('produto_id',copao,'quantidade',9)));
  pedido:=(r->>'id')::uuid;
  if (select estoque from public.produtos where id=garrafa)<>0 then raise exception 'FAIL 9 cups should consume 900ml';end if;
  perform public.salvar_composicao_kit(copao,jsonb_build_array(jsonb_build_object('componente_id',garrafa,'quantidade',200)));
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=garrafa)<>900 then raise exception 'FAIL cancellation used new recipe';end if;
  update public.pedidos set status='novo' where id=pedido;
  if (select estoque from public.produtos where id=garrafa)<>0 then raise exception 'FAIL reactivation used new recipe';end if;
  update public.pedidos set status='cancelado' where id=pedido;

  if privado.caixa_aberto() is null then perform public.abrir_caixa(0);end if;
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',copao,'quantidade',1),jsonb_build_object('produto_id',garrafa,'quantidade',1)),'pix');
    raise exception using errcode='XX000',message='FAIL shared bottle + cup shortage accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select estoque from public.produtos where id=garrafa)<>900 then raise exception 'FAIL shared stock rollback';end if;
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',copao,'quantidade',4)),'pix');
  venda:=(r->>'id')::uuid;
  if (select estoque from public.produtos where id=garrafa)<>100 then raise exception 'FAIL PDV consumption 800ml';end if;
  update public.pedidos set status='cancelado' where id=venda;
  if (select estoque from public.produtos where id=garrafa)<>900 then raise exception 'FAIL PDV cancel';end if;
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',garrafa,'quantidade',1)),'pix');
  if (select estoque from public.produtos where id=garrafa)<>0 then raise exception 'FAIL bottle sale must consume 900ml';end if;
  delete from public.pedidos where id=(r->>'id')::uuid;
  if (select estoque from public.produtos where id=garrafa)<>900 then raise exception 'FAIL deleted sale restore';end if;

  begin
    perform public.salvar_composicao_kit(fardo,jsonb_build_array(jsonb_build_object('componente_id',copao,'quantidade',1)));
    raise exception using errcode='XX000',message='FAIL nested kit accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    update public.produtos set unidade_estoque='un' where id=garrafa;
    raise exception using errcode='XX000',message='FAIL destructive unit change accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    update public.produtos set controla_estoque=false where id=lata;
    raise exception using errcode='XX000',message='FAIL component disabled tracking';
  exception when sqlstate 'P0001' then null;end;

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin
    perform public.salvar_composicao_kit(fardo,'[]'::jsonb);
    raise exception using errcode='XX000',message='FAIL unauthenticated composition change accepted';
  exception when sqlstate 'P0001' then null;end;
end;
$test$;
rollback;
select 'PASS: units, ml, shared stock, site, PDV, atomic shortage, cancellation, recipe snapshots, reactivation, deletion, nested-kit and admin guards. All fixtures rolled back.' as resultado;
