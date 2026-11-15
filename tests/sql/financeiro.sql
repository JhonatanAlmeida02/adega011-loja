begin;
do $$
declare admin_id uuid; v_padrao uuid; banco uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  transferencia uuid:=gen_random_uuid(); entrada uuid:=gen_random_uuid(); saida uuid:=gen_random_uuid(); ajuste uuid:=gen_random_uuid(); antigo uuid:=gen_random_uuid();
  n bigint; r jsonb; dia date:=(now() at time zone 'America/Sao_Paulo')::date; produto uuid:=gen_random_uuid(); venda_real uuid; antes bigint;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  select c.id into v_padrao from public.financeiro_contas c where c.padrao;
  if exists(select 1 from public.financeiro_vendas) then raise exception 'FAIL old sales were backfilled';end if;
  -- Simulate a pre-module order without touching any existing store order.
  insert into public.pedidos(id,numero,criado_em,status,cliente_nome,cliente_telefone,tipo,pagamento,itens,subtotal,total,origem)
    overriding system value values(antigo,-990000003,now()-interval '3 days','concluido','QA ANTIGO','11900000000','retirada','pix','[]',100,100,'site');
  delete from public.financeiro_vendas where pedido_id=antigo;
  delete from public.financeiro_lancamentos where pedido_id=antigo;
  update public.pedidos set total=200,subtotal=200 where id=antigo;
  if exists(select 1 from public.financeiro_vendas where pedido_id=antigo) then raise exception 'FAIL historical edit invented a receipt';end if;
  perform public.financeiro_salvar_conta(banco,'QA BANCO','banco',false,true,10000);
  perform public.financeiro_salvar_conta(banco,'QA BANCO','banco',false,true,10000);
  if (select saldo from public.financeiro_saldos where id=banco)<>10000 then raise exception 'FAIL repeated opening balance';end if;
  insert into public.pedidos(id,numero,status,cliente_nome,cliente_telefone,tipo,pagamento,itens,subtotal,total,origem)
    overriding system value values(a,-990000001,'novo','QA FINANCEIRO SITE','11900000000','retirada','dinheiro','[]',1000,1000,'site');
  if exists(select 1 from public.financeiro_vendas where pedido_id=a) then raise exception 'FAIL pending order received';end if;
  update public.pedidos set status='concluido',valor_recebido=2000 where id=a;
  update public.pedidos set status='concluido' where id=a;
  if (select saldo from public.financeiro_saldos where id=v_padrao)<>1000 or (select count(*) from public.financeiro_lancamentos where pedido_id=a and tipo='venda')<>1 then raise exception 'FAIL sale duplication or change counted as income';end if;
  perform public.financeiro_lancar(transferencia,'transferencia',v_padrao,banco,300,'QA TRANSFERIR','Transferência',dia);
  perform public.financeiro_lancar(transferencia,'transferencia',v_padrao,banco,300,'QA TRANSFERIR','Transferência',dia);
  if (select saldo from public.financeiro_saldos where id=v_padrao)<>700 or (select saldo from public.financeiro_saldos where id=banco)<>10300 or (select sum(saldo) from public.financeiro_saldos)<>11000 then raise exception 'FAIL transfer or idempotency';end if;
  begin
    perform public.financeiro_lancar(transferencia,'transferencia',v_padrao,banco,999,'QA TRANSFERIR','Transferência',dia);
    raise exception using errcode='XX000',message='FAIL different payload accepted';
  exception when sqlstate 'P0001' then null;end;
  update public.pedidos set status='cancelado' where id=a;
  update public.pedidos set status='cancelado' where id=a;
  if (select saldo from public.financeiro_saldos where id=v_padrao)<>-300 or exists(select 1 from public.financeiro_vendas where pedido_id=a) then raise exception 'FAIL sale cancellation';end if;
  update public.pedidos set status='confirmado' where id=a;
  if exists(select 1 from public.financeiro_vendas where pedido_id=a) then raise exception 'FAIL uncompleted reactivation received';end if;
  update public.pedidos set status='concluido' where id=a;
  perform public.financeiro_salvar_conta(banco,'QA BANCO','banco',true,true,0);
  insert into public.pedidos(id,numero,status,cliente_nome,cliente_telefone,tipo,pagamento,itens,subtotal,total,origem)
    overriding system value values(b,-990000002,'concluido','QA FINANCEIRO PDV','11900000000','balcao','cartao','[]',2000,2000,'balcao');
  if (select saldo from public.financeiro_saldos where id=banco)<>12300 or (select saldo from public.financeiro_saldos where id=v_padrao)<>700 then raise exception 'FAIL new default moved old funds or did not receive PDV';end if;
  update public.pedidos set total=1200,subtotal=1200 where id=a;
  if (select saldo from public.financeiro_saldos where id=v_padrao)<>900 or (select conta_id from public.financeiro_vendas where pedido_id=a)<>v_padrao then raise exception 'FAIL edit changed original destination';end if;
  r:=public.financeiro_historico_vendas(dia,dia,1,'QA FINANCEIRO','balcao','concluido','cartao');
  if (r->>'total')::integer<>1 or (r->>'faturamento')::bigint<>2000 then raise exception 'FAIL history filters';end if;
  update public.pedidos set status='cancelado' where id=b;
  delete from public.pedidos where id=a;
  if (select sum(saldo) from public.financeiro_saldos)<>10000 or not exists(select 1 from public.financeiro_lancamentos where pedido_numero=-990000001 and tipo='estorno_venda') then raise exception 'FAIL deletion lost audit or failed to reverse';end if;
  perform public.financeiro_estornar(transferencia,'QA desfazer transferência');
  perform public.financeiro_estornar(transferencia,'QA desfazer transferência');
  if (select saldo from public.financeiro_saldos where id=v_padrao)<>0 or (select saldo from public.financeiro_saldos where id=banco)<>10000 then raise exception 'FAIL transfer reversal';end if;
  perform public.financeiro_lancar(entrada,'entrada',null,banco,500,'QA ENTRADA','Outros',dia);
  perform public.financeiro_lancar(saida,'saida',banco,null,200,'QA DESPESA','Fornecedor',dia);
  r:=public.financeiro_painel(dia,dia);
  if (r->'resumo'->>'entradas')::bigint-(r->'resumo'->>'saidas')::bigint<>300 then raise exception 'FAIL transfers/openings counted as revenue';end if;
  perform public.financeiro_estornar(entrada,'QA corrigir entrada');
  if (select saldo from public.financeiro_saldos where id=banco)<>9800 then raise exception 'FAIL entry reversal';end if;
  perform public.financeiro_conferir_saldo(ajuste,banco,9999,9800,'QA conferência');
  perform public.financeiro_conferir_saldo(ajuste,banco,9999,9800,'QA conferência');
  if (select saldo from public.financeiro_saldos where id=banco)<>9999 then raise exception 'FAIL balance reconciliation duplicated';end if;
  begin
    perform public.financeiro_conferir_saldo(gen_random_uuid(),banco,12345,9800,'QA stale');
    raise exception using errcode='XX000',message='FAIL stale reconciliation accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.financeiro_lancar(gen_random_uuid(),'transferencia',banco,banco,1,'QA inválido','',dia);
    raise exception using errcode='XX000',message='FAIL same account transfer accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.financeiro_lancar(gen_random_uuid(),'saida',banco,null,-1,'QA negativo','',dia);
    raise exception using errcode='XX000',message='FAIL negative amount accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.financeiro_salvar_conta(banco,'QA BANCO','banco',true,false,0);
    raise exception using errcode='XX000',message='FAIL inactive default accepted';
  exception when sqlstate 'P0001' then null;end;
  for n in 1..55 loop perform public.financeiro_lancar(gen_random_uuid(),'entrada',null,banco,1,'QA PAGINACAO','',dia);end loop;
  r:=public.financeiro_painel(dia,dia,null,1);
  if jsonb_array_length(r->'lancamentos')<>50 or (r->>'total')::integer<=50 then raise exception 'FAIL server pagination';end if;
  r:=public.financeiro_painel(dia,dia,null,2);
  if jsonb_array_length(r->'lancamentos')=0 then raise exception 'FAIL second page';end if;
  -- Exercise the actual PDV RPC and its stock transaction, not only the trigger.
  if not exists(select 1 from public.caixas where fechado_em is null) then perform public.abrir_caixa(0);end if;
  insert into public.produtos(id,nome,preco,controla_estoque,estoque) values(produto,'QA FINANCEIRO PDV INTEGRADO',400,true,0);
  select count(*) into antes from public.financeiro_lancamentos;
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1)),'pix',0,null,'QA SEM ESTOQUE');
    raise exception using errcode='XX000',message='FAIL out-of-stock sale accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select count(*) from public.financeiro_lancamentos)<>antes then raise exception 'FAIL failed sale left a financial receipt';end if;
  perform public.ajustar_estoque(produto,'entrada',3);
  r:=public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1)),'pix',0,null,'QA PDV INTEGRADO');
  venda_real:=(r->>'id')::uuid;
  if not exists(select 1 from public.financeiro_vendas where pedido_id=venda_real and conta_id=banco and valor=400) or (select estoque from public.produtos where id=produto)<>2 then raise exception 'FAIL real PDV/stock/finance integration';end if;
  update public.pedidos set status='cancelado' where id=venda_real;
  if exists(select 1 from public.financeiro_vendas where pedido_id=venda_real) or (select estoque from public.produtos where id=produto)<>3 then raise exception 'FAIL real PDV cancellation';end if;
  if has_table_privilege('authenticated','public.financeiro_lancamentos','UPDATE') or has_table_privilege('anon','public.financeiro_contas','SELECT') or has_function_privilege('anon','public.financeiro_painel(date,date,uuid,integer)','execute') then raise exception 'FAIL finance grants';end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.financeiro_painel(dia,dia);
    raise exception using errcode='XX000',message='FAIL non-admin read';
  exception when sqlstate 'P0001' then null;end;
end;$$;
rollback;
select 'PASS: automatic site/PDV receipts, no historical backfill, change, retries, cancellation, reactivation, deletion audit, default changes, transfers, reversals, manual entries, balance reconciliation, pagination and authorization. Fixtures rolled back.' as resultado;
