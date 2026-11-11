begin;
do $$
declare admin_id uuid; familia uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  kit uuid:=gen_random_uuid(); outra uuid:=gen_random_uuid(); lista jsonb; dados jsonb:='{"nome":"QA Skol","preco":0,"unidade_estoque":"un"}'; consumo jsonb;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  -- Adopt an existing simple SKU: its ID, stock, kit links and history survive.
  perform public.salvar_produto_com_kit(a,'{"nome":"QA Skol 269","preco":400,"controla_estoque":true}','[]');
  perform public.ajustar_estoque(a,'entrada',31);
  perform public.salvar_produto_com_kit(kit,'{"nome":"QA Fardo","preco":4400,"eh_kit":true}',jsonb_build_array(jsonb_build_object('componente_id',a,'quantidade',15)));
  lista:=jsonb_build_array(jsonb_build_object('id',a,'nome','269 ml','preco',400),jsonb_build_object('id',b,'nome','350 ml','preco',500));
  perform public.salvar_produto_variacoes(familia,dados,'Tamanho',lista);
  perform public.salvar_produto_variacoes(familia,dados,'Tamanho',lista);
  if (select count(*) from public.produtos where familia_id=familia)<>2 then raise exception 'FAIL duplicate retry';end if;
  if (select estoque from public.produtos where id=a)<>31 or (select estoque from public.produtos where id=b)<>0 then raise exception 'FAIL stock was replaced or invented';end if;
  if (select saldo from public.saldos_venda() where produto_id=kit)<>2 then raise exception 'FAIL kit link broken';end if;
  perform public.ajustar_estoque(b,'entrada',5);
  consumo:=privado.consumo_itens(jsonb_build_array(jsonb_build_object('produto_id',b,'quantidade',2),jsonb_build_object('produto_id',kit,'quantidade',1)));
  if not exists(select 1 from jsonb_array_elements(consumo)e where (e->>'produto_id')::uuid=a and (e->>'quantidade')::integer=15) or
     not exists(select 1 from jsonb_array_elements(consumo)e where (e->>'produto_id')::uuid=b and (e->>'quantidade')::integer=2) then raise exception 'FAIL mixed variation/kit consumption';end if;
  begin
    perform public.salvar_produto_variacoes(familia,dados||'{"nome":"QA must rollback"}', 'Tamanho',jsonb_build_array(jsonb_build_object('id',a,'nome','269 ml','preco',100),jsonb_build_object('id',b,'nome','350 ml','preco',-1)));
    raise exception using errcode='XX000',message='FAIL invalid price accepted';
  exception when check_violation then null;end;
  if (select preco from public.produtos where id=a)<>400 or (select familia_nome from public.produtos where id=a)<>'QA Skol' then raise exception 'FAIL group not atomic';end if;
  begin
    perform public.salvar_produto_variacoes(familia,dados,'Sabor',jsonb_build_array(lista->0,(lista->1)||'{"nome":"269 ML"}'));
    raise exception using errcode='XX000',message='FAIL duplicate labels accepted';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.salvar_produto_variacoes(familia,dados,'Tamanho',jsonb_build_array(lista->0));
    raise exception using errcode='XX000',message='FAIL existing SKU silently removed';
  exception when sqlstate 'P0001' then null;end;
  begin
    perform public.salvar_produto_variacoes(outra,dados,'Tamanho',lista);
    raise exception using errcode='XX000',message='FAIL variation stolen from another family';
  exception when sqlstate 'P0001' then null;end;
  -- The same label is valid in a different family.
  perform public.salvar_produto_variacoes(outra,dados||'{"nome":"QA Outra"}','Tamanho',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'nome','269 ml','preco',300)));
  -- Inactive options retain stock and links; no destructive deletion needed.
  perform public.salvar_produto_variacoes(familia,dados,'Tamanho',jsonb_build_array((lista->0)||'{"ativo":false}',lista->1));
  if (select ativo from public.produtos where id=a) or (select estoque from public.produtos where id=a)<>31 then raise exception 'FAIL deactivation erased stock';end if;
  -- Per-SKU photos survive unrelated edits; explicit null only clears that SKU.
  perform public.salvar_produto_variacoes(familia,dados,'Tamanho',jsonb_build_array((lista->0)||'{"foto_url":"https://example.com/269.jpg"}',(lista->1)||'{"foto_url":"https://example.com/350.jpg"}'));
  if (select foto_url from public.produtos where id=a) is distinct from 'https://example.com/269.jpg'
    or (select foto_url from public.produtos where id=b) is distinct from 'https://example.com/350.jpg' then raise exception 'FAIL distinct photos not saved';end if;
  perform public.salvar_produto_variacoes(familia,dados||'{"foto_url":"https://example.com/common.jpg"}','Tamanho',lista);
  if (select foto_url from public.produtos where id=a) is distinct from 'https://example.com/269.jpg'
    or (select foto_url from public.produtos where id=b) is distinct from 'https://example.com/350.jpg' then raise exception 'FAIL legacy edit overwrote SKU photos';end if;
  perform public.salvar_produto_variacoes(familia,dados,'Tamanho',jsonb_build_array((lista->0)||'{"foto_url":null}',lista->1));
  if (select foto_url from public.produtos where id=a) is not null
    or (select foto_url from public.produtos where id=b) is distinct from 'https://example.com/350.jpg' then raise exception 'FAIL clearing one photo changed another';end if;
  begin
    perform public.salvar_produto_variacoes(familia,dados,'Tamanho',jsonb_build_array((lista->0)||'{"foto_url":"https://example.com/rollback.jpg"}',(lista->1)||'{"preco":-1}'));
    raise exception using errcode='XX000',message='FAIL invalid photo transaction accepted';
  exception when check_violation then null;end;
  if (select foto_url from public.produtos where id=a) is not null then raise exception 'FAIL photos not atomic';end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin
    perform public.salvar_produto_variacoes(familia,dados,'Tamanho',lista);
    raise exception using errcode='XX000',message='FAIL non-admin accepted';
  exception when sqlstate 'P0001' then null;end;
end;$$;
rollback;
select 'PASS: atomic variations, retry, preserved SKU/stock/kit, isolated consumption, duplicate validation, stale edit protection, deactivation, per-SKU photos and admin authorization. Fixtures rolled back.' as resultado;
