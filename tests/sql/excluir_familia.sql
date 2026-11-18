-- A mesma exclusão única usada na interface deve ser atômica.
begin;
do $$
declare
  familia uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  kit uuid := gen_random_uuid();
  grupo uuid := gen_random_uuid();
  quantidade integer;
begin
  insert into public.produtos(id,nome,preco,familia_id,familia_nome,variacao_atributo,variacao_nome)
    values(v1,'QA FAMÍLIA · 269ML',400,familia,'QA FAMÍLIA','TAMANHO','269ML'),
          (v2,'QA FAMÍLIA · 350ML',500,familia,'QA FAMÍLIA','TAMANHO','350ML');
  insert into public.produtos(id,nome,preco,eh_kit) values(kit,'QA KIT',1000,true);
  insert into public.kit_componentes(kit_id,componente_id,quantidade) values(kit,v2,2);
  insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo) values(grupo,v1,'QA GRUPO',0,1);
  insert into public.opcoes(grupo_id,nome,preco) values(grupo,'QA OPÇÃO',100);
  begin
    delete from public.produtos where familia_id=familia;
    raise exception 'Deveria bloquear família vinculada.';
  exception when foreign_key_violation then null;
  end;
  if (select count(*) from public.produtos where familia_id=familia)<>2 then raise exception 'Exclusão parcial de família vinculada.'; end if;
  if not exists(select 1 from public.grupos_opcoes where id=grupo) then raise exception 'Perdeu adicionais após falha.'; end if;
  delete from public.kit_componentes where kit_id=kit;
  delete from public.produtos where familia_id=familia;
  get diagnostics quantidade = row_count;
  if quantidade<>2 then raise exception 'Não excluiu todas as variações.'; end if;
  if exists(select 1 from public.grupos_opcoes where id=grupo)
    or exists(select 1 from public.opcoes where grupo_id=grupo) then raise exception 'Adicionais órfãos.'; end if;
  if not exists(select 1 from public.produtos where id=kit) then raise exception 'Excluiu produto fora da família.'; end if;
end;
$$;
rollback;
