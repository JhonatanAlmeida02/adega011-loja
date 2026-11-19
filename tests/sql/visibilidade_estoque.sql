begin;
do $$
declare
  admin_id uuid := (select user_id from public.admins limit 1);
  produto uuid := gen_random_uuid();
  insumo uuid := gen_random_uuid();
  copia uuid := gen_random_uuid();
  familia uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  dados jsonb := '{"nome":"QA VISIBILIDADE","preco":1000,"controla_estoque":true,"ativo":true,"visibilidade":"automatico","consumo_proprio":false}';
  retorno jsonb;
begin
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  retorno:=public.salvar_cadastro_produto(produto,dados,'[]',null,'','[]','[]');
  if retorno->>'visibilidade'<>'automatico' then raise exception 'Não salvou automático.';end if;
  update public.produtos set estoque=2 where id=produto;
  update public.produtos set estoque=0 where id=produto;
  if not exists(select 1 from public.produtos where id=produto and ativo and visibilidade='automatico') then raise exception 'Estoque sobrescreveu preferência.';end if;
  perform public.salvar_cadastro_produto(produto,dados||'{"visibilidade":"visivel"}','[]',null,'','[]','[]');
  if not exists(select 1 from public.produtos where id=produto and ativo and estoque=0 and visibilidade='visivel') then raise exception 'Não forçou visibilidade sem saldo.';end if;
  perform public.salvar_cadastro_produto(produto,dados||'{"visibilidade":"oculto"}','[]',null,'','[]','[]');
  update public.produtos set estoque=10 where id=produto;
  if not exists(select 1 from public.produtos where id=produto and not ativo and visibilidade='oculto') then raise exception 'Entrada revelou oculto manual.';end if;
  update public.produtos set ativo=true where id=produto;
  if (select visibilidade from public.produtos where id=produto)<>'visivel' then raise exception 'Botão legado não funciona.';end if;
  perform public.salvar_cadastro_produto(produto,dados,'[]',null,'','[]','[]');
  if (select visibilidade from public.produtos where id=produto)<>'automatico' then raise exception 'Não voltou ao automático.';end if;
  insert into public.produtos(id,nome,preco,categoria_id,controla_estoque)
    values(insumo,'QA INSUMO',0,(select id from public.categorias where slug='insumos' limit 1),true);
  if not exists(select 1 from public.produtos where id=insumo and consumo_proprio and not ativo and visibilidade='oculto') then raise exception 'Novo insumo não começou oculto.';end if;
  perform public.salvar_cadastro_produto(produto,dados||'{"consumo_proprio":true}','[]',null,'','[]','[]');
  if not exists(select 1 from public.produtos where id=produto and consumo_proprio and not ativo) then raise exception 'Consumo próprio visível por padrão.';end if;
  perform public.salvar_cadastro_produto(produto,dados||'{"consumo_proprio":true,"visibilidade":"visivel"}','[]',null,'','[]','[]');
  if not exists(select 1 from public.produtos where id=produto and consumo_proprio and ativo) then raise exception 'Admin não conseguiu exibir consumo próprio.';end if;
  perform public.clonar_produto(produto,copia);
  if not exists(select 1 from public.produtos where id=copia and consumo_proprio and not ativo and visibilidade='oculto') then raise exception 'Clone perdeu consumo próprio.';end if;
  perform public.salvar_cadastro_produto(v1,dados||'{"nome":"QA FAMÍLIA"}','[]',familia,'Tamanho',
    jsonb_build_array(jsonb_build_object('id',v1,'nome','269ML','preco',400,'visibilidade','automatico'),
      jsonb_build_object('id',v2,'nome','350ML','preco',500,'visibilidade','oculto')),'[]');
  if not exists(select 1 from public.produtos where id=v1 and visibilidade='automatico' and ativo)
    or not exists(select 1 from public.produtos where id=v2 and visibilidade='oculto' and not ativo) then raise exception 'Perdeu regras por variação.';end if;
  begin
    perform public.salvar_cadastro_produto(produto,dados||'{"visibilidade":"invalido"}','[]',null,'','[]','[]');
    raise exception 'Aceitou modo inválido.';
  exception when check_violation then null;end;
  if not exists(select 1 from public.produtos where id=produto and consumo_proprio and visibilidade='visivel') then raise exception 'Falha parcial no cadastro.';end if;
end;$$;
rollback;
