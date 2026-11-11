begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); g uuid:=gen_random_uuid();
  v1 uuid:=gen_random_uuid(); v2 uuid:=gen_random_uuid(); invalido uuid:=gen_random_uuid(); admin_id uuid; saldo integer; consumo jsonb;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform public.salvar_produto_com_kit(a,'{"nome":"QA Seda pacote","preco":100,"controla_estoque":true,"unidades_pacote":50}','[]');
  saldo:=public.registrar_entrada_estoque(a,10,'pacote',50,'Fornecedor teste');
  if saldo<>500 then raise exception 'FAIL 10 packs should add 500 units';end if;
  if not exists(select 1 from public.estoque_movimentos where produto_id=a and quantidade=500 and unidade='un' and observacao like '10 pacotes x 50 un = 500 un%Fornecedor teste') then raise exception 'FAIL converted amount and packaging snapshot absent from ledger';end if;
  consumo:=privado.consumo_itens(jsonb_build_array(jsonb_build_object('produto_id',a,'quantidade',1)));
  if (consumo->0->>'quantidade')::integer<>1 then raise exception 'FAIL loose sale must consume only one unit';end if;
  perform public.salvar_produto_com_kit(k,'{"nome":"QA Kit folhas","preco":400,"eh_kit":true}',jsonb_build_array(jsonb_build_object('componente_id',a,'quantidade',5)));
  if (select s.saldo from public.saldos_venda() s where s.produto_id=k)<>100 then raise exception 'FAIL kit changed with package factor';end if;
  -- Older callers omitting the field preserve the configured package size.
  perform public.salvar_produto_com_kit(a,'{"nome":"QA Seda pacote","preco":100,"controla_estoque":true}','[]');
  if (select unidades_pacote from public.produtos where id=a)<>50 then raise exception 'FAIL legacy edit reset package size';end if;
  perform public.salvar_produto_com_kit(a,'{"nome":"QA Seda pacote","preco":100,"controla_estoque":true,"unidades_pacote":100}','[]');
  if (select estoque from public.produtos where id=a)<>500 then raise exception 'FAIL config change rewrote current stock';end if;
  begin
    perform public.registrar_entrada_estoque(a,10,'pacote',50);
    raise exception using errcode='XX000',message='FAIL stale factor accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select estoque from public.produtos where id=a)<>500 then raise exception 'FAIL stale request mutated stock';end if;
  saldo:=public.registrar_entrada_estoque(a,1,'pacote',100);
  if saldo<>600 then raise exception 'FAIL new packaging factor not used';end if;
  saldo:=public.registrar_entrada_estoque(a,3,'base',1);
  if saldo<>603 then raise exception 'FAIL loose input multiplied';end if;
  saldo:=public.ajustar_estoque(a,'ajuste',9);
  if saldo<>9 then raise exception 'FAIL count was multiplied by package size';end if;
  perform public.salvar_produto_com_kit(b,'{"nome":"QA Garrafa pacote","preco":2200,"controla_estoque":true,"unidade_estoque":"ml","volume_unidade":900}','[]');
  saldo:=public.registrar_entrada_estoque(b,2,'garrafa',900);
  if saldo<>1800 then raise exception 'FAIL bottle conversion regression';end if;
  saldo:=public.registrar_entrada_estoque(b,100,'base',1);
  if saldo<>1900 then raise exception 'FAIL loose ml multiplied';end if;
  begin
    perform public.registrar_entrada_estoque(b,1,'pacote',50);
    raise exception using errcode='XX000',message='FAIL unit packages accepted for ml';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.registrar_entrada_estoque(k,1,'pacote',50);
    raise exception using errcode='XX000',message='FAIL kit received stock';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.registrar_entrada_estoque(a,2147483647,'pacote',100);
    raise exception using errcode='XX000',message='FAIL overflow accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.registrar_entrada_estoque(a,0,'base',1);
    raise exception using errcode='XX000',message='FAIL zero input accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.salvar_produto_com_kit(invalido,'{"nome":"QA Invalid pack","preco":100,"unidades_pacote":0}','[]');
    raise exception using errcode='XX000',message='FAIL invalid package saved';
  exception when check_violation then null;end;
  if exists(select 1 from public.produtos where id=invalido) then raise exception 'FAIL partial invalid product persisted';end if;
  perform public.salvar_produto_variacoes(g,'{"nome":"QA Variações pacotes","preco":100}','Sabor',jsonb_build_array(
    jsonb_build_object('id',v1,'nome','A','preco',100,'unidades_pacote',25),jsonb_build_object('id',v2,'nome','B','preco',100,'unidades_pacote',50)));
  if public.registrar_entrada_estoque(v1,2,'pacote',25)<>50 or public.registrar_entrada_estoque(v2,2,'pacote',50)<>100 then raise exception 'FAIL per-variation packaging';end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin
    perform public.registrar_entrada_estoque(a,10,'pacote',100);
    raise exception using errcode='XX000',message='FAIL non-admin entry accepted';
  exception when sqlstate 'P0001' then null;end;
end;$$;
rollback;
select 'PASS: 10 x 50 = 500; loose sale consumes 1; kits, bottle inputs, counts, history, per-variation factors, limits, stale-factor protection and admin authorization. Fixtures rolled back.' as resultado;
