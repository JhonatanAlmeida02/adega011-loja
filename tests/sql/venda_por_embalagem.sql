begin;
set local statement_timeout='25s';
do $$
declare pacote uuid:=gen_random_uuid();solta uuid:=gen_random_uuid();litro uuid:=gen_random_uuid();
  admin_id uuid;r jsonb;pedido uuid;n integer;antes integer;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.configuracoes set status_manual='aberta',pedido_minimo=0,aceita_retirada=true,pagamentos=array['pix','dinheiro','cartao'] where id=1;
  perform public.salvar_produto_com_kit(pacote,'{"nome":"QA Pacote 50","preco":500,"controla_estoque":true,"unidades_pacote":50,"vende_pacote":true}','[]');
  perform public.ajustar_estoque(pacote,'entrada',248);
  perform public.salvar_produto_com_kit(solta,'{"nome":"QA Folha avulsa","preco":50,"eh_kit":true}',jsonb_build_array(jsonb_build_object('componente_id',pacote,'quantidade',1)));
  if (select volume_unidade from public.produtos where id=pacote)<>50 then raise exception 'FAIL package sale factor not derived';end if;
  if (select saldo from public.saldos_venda() where produto_id=pacote)<>4 or (select saldo from public.saldos_venda() where produto_id=solta)<>248 then raise exception 'FAIL sellable package / leaf balances';end if;
  -- One package plus one loose leaf consume the same physical stock (51 UN).
  r:=public.criar_pedido('QA Pacote','11999123401','retirada',null,null,'pix',null,null,
    jsonb_build_array(jsonb_build_object('produto_id',pacote,'quantidade',1),jsonb_build_object('produto_id',solta,'quantidade',1)));
  pedido:=(r->>'id')::uuid;
  if (select estoque from public.produtos where id=pacote)<>197 then raise exception 'FAIL site must consume 50+1';end if;
  if (select subtotal from public.pedidos where id=pedido)<>550 then raise exception 'FAIL factor must not multiply price';end if;
  -- A later packaging change cannot change the old sale's cancellation amount.
  update public.produtos set unidades_pacote=60 where id=pacote;
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=pacote)<>248 then raise exception 'FAIL cancel used current factor instead of original 51';end if;
  update public.produtos set unidades_pacote=50 where id=pacote;
  if not exists(select 1 from public.caixas where fechado_em is null) then perform public.abrir_caixa(0);end if;
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',pacote,'quantidade',1)),'pix');
  pedido:=(r->>'id')::uuid;
  if (select estoque from public.produtos where id=pacote)<>198 then raise exception 'FAIL PDV must consume 50';end if;
  if (select subtotal from public.pedidos where id=pedido)<>500 then raise exception 'FAIL PDV package price multiplied';end if;
  update public.pedidos set status='cancelado' where id=pedido;
  if (select estoque from public.produtos where id=pacote)<>248 then raise exception 'FAIL PDV cancellation';end if;
  select count(*) into antes from public.pedidos;
  begin
    perform public.criar_pedido('QA shortage','11999123402','retirada',null,null,'pix',null,null,
      jsonb_build_array(jsonb_build_object('produto_id',pacote,'quantidade',4),jsonb_build_object('produto_id',solta,'quantidade',49)));
    raise exception using errcode='XX000',message='FAIL combined shortage accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select estoque from public.produtos where id=pacote)<>248 or (select count(*) from public.pedidos)<>antes then raise exception 'FAIL shortage not atomic';end if;
  perform public.ajustar_estoque(pacote,'ajuste',49);
  if (select saldo from public.saldos_venda() where produto_id=pacote)<>0 or (select saldo from public.saldos_venda() where produto_id=solta)<>49 then raise exception 'FAIL partial package availability';end if;
  perform public.salvar_produto_com_kit(litro,'{"nome":"QA Litro","preco":2200,"controla_estoque":true,"unidade_estoque":"ml","volume_unidade":1000}','[]');
  perform public.ajustar_estoque(litro,'entrada',2500);
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',litro,'quantidade',1)),'pix');
  if (select estoque from public.produtos where id=litro)<>1500 then raise exception 'FAIL litre must consume 1000ml';end if;
  -- Configuration edits preserve physical stock and legacy clients preserve mode.
  perform public.salvar_produto_com_kit(pacote,'{"nome":"QA Pacote 50","preco":500,"controla_estoque":true}','[]');
  if not(select vende_pacote from public.produtos where id=pacote) or (select volume_unidade from public.produtos where id=pacote)<>50 or (select estoque from public.produtos where id=pacote)<>49 then raise exception 'FAIL legacy metadata edit lost package mode';end if;
end;$$;
rollback;
select 'PASS: package 50, shared loose leaf 1, site/PDV, correct price, atomic shortage, original-quantity cancellations, incomplete packages and litre 1000ml. All fixtures rolled back.' as resultado;
