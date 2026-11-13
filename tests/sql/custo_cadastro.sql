begin;
do $$
declare admin_id uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); k uuid:=gen_random_uuid();
  familia uuid:=gen_random_uuid(); novo uuid:=gen_random_uuid(); dados jsonb; custos jsonb; lista jsonb; historico jsonb; invalido jsonb;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  dados:='{"nome":"QA CUSTO","preco":500,"controla_estoque":true}';
  custos:=jsonb_build_array(jsonb_build_object('produto_id',a,'custo',125));
  perform public.salvar_cadastro_produto(a,dados,'[]',null,null,'[]',custos);
  if (select custo from public.produto_importacao where produto_id=a) is distinct from 125 then raise exception 'FAIL new product cost not saved';end if;
  update public.produto_importacao set codigo='QA-CUSTO-'||a::text,codigo_pai='QA-PAI',origem='{"tipo":"insumo","original":true}' where produto_id=a;
  perform public.ajustar_estoque(a,'entrada',17);
  select jsonb_agg(to_jsonb(m) order by m.id) into historico from public.estoque_movimentos m where produto_id=a;
  perform public.salvar_cadastro_produto(a,dados||'{"nome":"QA CUSTO EDITADO","preco":600}','[]',null,null,'[]',jsonb_build_array(jsonb_build_object('produto_id',a,'custo',175)));
  if (select custo from public.produto_importacao where produto_id=a) is distinct from 175
    or (select codigo from public.produto_importacao where produto_id=a) is distinct from 'QA-CUSTO-'||a::text
    or (select codigo_pai from public.produto_importacao where produto_id=a) is distinct from 'QA-PAI'
    or (select origem from public.produto_importacao where produto_id=a) is distinct from '{"tipo":"insumo","original":true}'::jsonb
    or (select estoque from public.produtos where id=a)<>17
    or (select jsonb_agg(to_jsonb(m) order by m.id) from public.estoque_movimentos m where produto_id=a) is distinct from historico then
    raise exception 'FAIL edit changed code, metadata, inventory or history';end if;
  perform public.salvar_cadastro_produto(a,dados,'[]',null,null,'[]','[]');
  if (select custo from public.produto_importacao where produto_id=a) is distinct from 175 then raise exception 'FAIL untouched cost overwritten';end if;
  perform public.salvar_cadastro_produto(a,dados,'[]',null,null,'[]',jsonb_build_array(jsonb_build_object('produto_id',a,'custo',0)));
  if (select custo from public.produto_importacao where produto_id=a) is distinct from 0 then raise exception 'FAIL zero cost rejected';end if;
  perform public.salvar_cadastro_produto(a,dados,'[]',null,null,'[]',jsonb_build_array(jsonb_build_object('produto_id',a,'custo',null)));
  if (select custo from public.produto_importacao where produto_id=a) is not null then raise exception 'FAIL clear cost';end if;
  -- Each variation keeps its own editable cost.
  lista:=jsonb_build_array(jsonb_build_object('id',a,'nome','LARANJA','preco',500),jsonb_build_object('id',b,'nome','UVA','preco',600));
  perform public.salvar_cadastro_produto(a,dados,'[]',familia,'Sabor',lista,jsonb_build_array(jsonb_build_object('produto_id',a,'custo',200),jsonb_build_object('produto_id',b,'custo',250)));
  if (select custo from public.produto_importacao where produto_id=a) is distinct from 200
    or (select custo from public.produto_importacao where produto_id=b) is distinct from 250 then raise exception 'FAIL independent variation costs';end if;
  -- Invalid costs roll back the product/variation save as well.
  for invalido in select value from jsonb_array_elements('[-1,0.5,2147483648,"2.50"]') loop
    begin
      perform public.salvar_cadastro_produto(a,dados||'{"nome":"QA MUST ROLLBACK"}','[]',familia,'Sabor',lista,jsonb_build_array(jsonb_build_object('produto_id',a,'custo',invalido)));
      raise exception using errcode='XX000',message='FAIL invalid cost accepted';
    exception when sqlstate 'P0001' then null;end;
    if (select familia_nome from public.produtos where id=a)<>'QA CUSTO' or (select custo from public.produto_importacao where produto_id=a)<>200 then raise exception 'FAIL partial save';end if;
  end loop;
  begin
    perform public.salvar_cadastro_produto(novo,dados,'[]',null,null,'[]',jsonb_build_array(jsonb_build_object('produto_id',a,'custo',999)));
    raise exception using errcode='XX000',message='FAIL unrelated cost accepted';
  exception when sqlstate 'P0001' then null;end;
  if exists(select 1 from public.produtos where id=novo) or (select custo from public.produto_importacao where produto_id=a)<>200 then raise exception 'FAIL unrelated edit was not atomic';end if;
  begin
    perform public.salvar_cadastro_produto(novo,dados,'[]',null,null,'[]',custos||custos);
    raise exception using errcode='XX000',message='FAIL duplicate cost accepted';
  exception when sqlstate 'P0001' then null;end;
  -- Recipe and manual kit cost use the same transaction.
  perform public.salvar_cadastro_produto(k,'{"nome":"QA KIT CUSTO","preco":1000,"eh_kit":true}',jsonb_build_array(jsonb_build_object('componente_id',a,'quantidade',2)),null,null,'[]',jsonb_build_array(jsonb_build_object('produto_id',k,'custo',400)));
  if (select custo from public.produto_importacao where produto_id=k)<>400 or (select quantidade from public.kit_componentes where kit_id=k and componente_id=a)<>2 then raise exception 'FAIL kit cost or recipe';end if;
  if (select estoque from public.produtos where id=a)<>17 then raise exception 'FAIL kit save moved inventory';end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.salvar_cadastro_produto(novo,dados,'[]',null,null,'[]','[]');
    raise exception using errcode='XX000',message='FAIL non-admin accepted';
  exception when sqlstate 'P0001' then null;end;
  if has_function_privilege('anon','public.salvar_cadastro_produto(uuid,jsonb,jsonb,uuid,text,jsonb,jsonb)','execute') then raise exception 'FAIL anonymous RPC access';end if;
end;$$;
rollback;
select 'PASS: editable simple, kit and variation costs; zero/clear; source metadata, stock and history preserved; atomic validation and admin authorization. Fixtures rolled back.' as resultado;
