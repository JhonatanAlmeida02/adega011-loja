begin;
do $$
declare base uuid:=gen_random_uuid();kit uuid:=gen_random_uuid();invalido uuid:=gen_random_uuid();r jsonb;admin_id uuid;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  insert into public.produtos(id,nome,preco,controla_estoque) values(base,'QA base cadastro',400,true);
  perform public.ajustar_estoque(base,'entrada',31);
  r:=public.salvar_produto_com_kit(kit,'{"nome":"QA kit cadastro","preco":4400,"eh_kit":true}'::jsonb,jsonb_build_array(jsonb_build_object('componente_id',base,'quantidade',15)));
  if (r->>'id')::uuid<>kit or not exists(select 1 from public.kit_componentes where kit_id=kit and componente_id=base and quantidade=15) then
    raise exception 'FAIL creation must save product and recipe together';end if;
  perform public.salvar_produto_com_kit(kit,'{"nome":"QA kit cadastro","preco":4400,"eh_kit":true}'::jsonb,jsonb_build_array(jsonb_build_object('componente_id',base,'quantidade',15)));
  if (select count(*) from public.produtos where id=kit)<>1 or (select count(*) from public.kit_componentes where kit_id=kit)<>1 then raise exception 'FAIL retry created duplicates';end if;
  begin
    perform public.salvar_produto_com_kit(kit,'{"nome":"QA should rollback","preco":1,"eh_kit":true}'::jsonb,jsonb_build_array(jsonb_build_object('componente_id',kit,'quantidade',1)));
    raise exception using errcode='XX000',message='FAIL invalid recipe accepted';
  exception when sqlstate 'P0001' then null;end;
  if (select nome from public.produtos where id=kit)<>'QA kit cadastro' or (select quantidade from public.kit_componentes where kit_id=kit)<>15 then raise exception 'FAIL edit was not atomic';end if;
  begin
    perform public.salvar_produto_com_kit(invalido,'{"nome":"QA invalid draft","preco":1,"eh_kit":true}'::jsonb,jsonb_build_array(jsonb_build_object('componente_id',gen_random_uuid(),'quantidade',1)));
    raise exception using errcode='XX000',message='FAIL nonexistent component accepted';
  exception when sqlstate 'P0001' then null;end;
  if exists(select 1 from public.produtos where id=invalido) then raise exception 'FAIL incomplete product persisted';end if;
  begin
    perform public.salvar_produto_com_kit(invalido,'{"nome":"QA empty kit","preco":1,"eh_kit":true}'::jsonb,'[]');
    raise exception using errcode='XX000',message='FAIL empty new kit accepted';
  exception when sqlstate 'P0001' then null;end;
  perform public.salvar_produto_com_kit(base,'{"nome":"QA base cadastro","preco":400,"controla_estoque":true,"estoque":99999}'::jsonb,'[]');
  if (select estoque from public.produtos where id=base)<>31 then raise exception 'FAIL browser overwrote stock balance';end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin
    perform public.salvar_produto_com_kit(invalido,'{"nome":"QA anon","preco":1}'::jsonb,'[]');
    raise exception using errcode='XX000',message='FAIL non-admin saved product';
  exception when sqlstate 'P0001' then null;end;
end;
$$;
rollback;
select 'PASS: single-save creation, idempotent retry, atomic edit/creation rollback, required composition, protected stock and admin-only access. Fixtures rolled back.' as resultado;
