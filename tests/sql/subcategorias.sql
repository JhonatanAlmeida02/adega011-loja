-- Subcategorias: um nível só, sem ciclo; excluir a principal devolve as subs ao topo.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/subcategorias.sql
begin;
do $test$
declare d uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); msg text;
begin
  insert into public.categorias(id,nome,slug,ordem) values (d,'QA Destilados','qa-destilados',90),(x,'QA Outra','qa-outra',91);
  insert into public.categorias(id,nome,slug,ordem,pai_id) values (v,'QA Vodka','qa-vodka',92,d),(g,'QA Gin','qa-gin',93,d);
  -- Subcategoria não pode ter subcategorias
  begin
    update public.categorias set pai_id=v where id=x;
    raise exception using errcode='XX000',message='FAIL dois níveis aceitos';
  exception when sqlstate 'P0001' then null;end;
  -- Principal com subcategorias não pode virar subcategoria
  begin
    update public.categorias set pai_id=x where id=d;
    raise exception using errcode='XX000',message='FAIL principal com filhas virou sub';
  exception when sqlstate 'P0001' then
    get stacked diagnostics msg = message_text;
    if msg not like 'Esta categoria tem subcategorias%' then raise exception 'FAIL mensagem: %',msg;end if;
  end;
  -- Dentro dela mesma
  begin
    update public.categorias set pai_id=x where id=x;
    raise exception using errcode='XX000',message='FAIL ciclo aceito';
  exception when sqlstate 'P0001' then null;end;
  -- Mudar só o nome não passa pela validação de pai e funciona
  update public.categorias set nome='QA Vodka Nova' where id=v;
  -- Excluir a principal: subcategorias voltam a ser principais
  delete from public.categorias where id=d;
  if exists(select 1 from public.categorias where id in (v,g) and pai_id is not null) then raise exception 'FAIL subs não voltaram ao topo';end if;
end;$test$;
rollback;
select 'PASS: subcategorias com um nível, sem ciclo, e principal excluída devolve as subcategorias ao topo. Dados de teste desfeitos.' as resultado;
