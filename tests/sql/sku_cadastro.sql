-- SKU no cadastro: produto simples, produto com variações (SKU do produto e de
-- cada variação), troca de códigos, duplicado recusado e vazio apagando.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/sku_cadastro.sql
begin;
set local statement_timeout='25s';
do $test$
declare
  admin_id uuid; simples uuid:=gen_random_uuid(); outro uuid:=gen_random_uuid(); familia uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); dados jsonb; lista jsonb; msg text;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  dados:='{"nome":"QA Lata","preco":500,"unidade_estoque":"un"}';

  -- Produto simples: grava, altera, apaga
  perform public.salvar_produto_com_kit(simples,dados||'{"codigo":"  QA-001 "}');
  if (select codigo from public.produto_importacao where produto_id=simples) is distinct from 'QA-001' then raise exception 'FAIL sku simples não gravado';end if;
  if (select origem->>'fonte' from public.produto_importacao where produto_id=simples) is distinct from 'cadastro' then raise exception 'FAIL origem';end if;
  perform public.salvar_produto_com_kit(simples,dados||'{"codigo":"QA-002"}');
  if (select codigo from public.produto_importacao where produto_id=simples) is distinct from 'QA-002' then raise exception 'FAIL sku não alterado';end if;
  -- Sem a chave "codigo" (cliente antigo) o SKU fica como está
  perform public.salvar_produto_com_kit(simples,dados);
  if (select codigo from public.produto_importacao where produto_id=simples) is distinct from 'QA-002' then raise exception 'FAIL sku apagado sem pedir';end if;

  -- Duplicado (sem diferenciar maiúsculas) é recusado e nada é gravado
  begin
    perform public.salvar_produto_com_kit(outro,'{"nome":"QA Outro","preco":100,"codigo":"qa-002"}');
    raise exception using errcode='XX000',message='FAIL sku duplicado aceito';
  exception when sqlstate 'P0001' then
    get stacked diagnostics msg = message_text;
    if msg not like 'O SKU qa-002 já está em uso por "QA Lata".' then raise exception 'FAIL mensagem: %',msg;end if;
  end;
  if exists(select 1 from public.produtos where id=outro) then raise exception 'FAIL produto gravado com sku duplicado';end if;

  -- Custo da planilha é preservado ao mudar o SKU; vazio apaga só o código
  update public.produto_importacao set custo=250 where produto_id=simples;
  perform public.salvar_produto_com_kit(simples,dados||'{"codigo":""}');
  if (select codigo from public.produto_importacao where produto_id=simples) is not null
    or (select custo from public.produto_importacao where produto_id=simples)<>250 then raise exception 'FAIL apagar sku';end if;

  -- Variações: SKU do produto (pai) e de cada variação
  dados:='{"nome":"QA Energético","unidade_estoque":"un","codigo":"QA-PAI"}';
  lista:=jsonb_build_array(
    jsonb_build_object('id',a,'nome','Melancia','preco',1200,'codigo','QA-M'),
    jsonb_build_object('id',b,'nome','Tropical','preco',1200,'codigo',''));
  perform public.salvar_produto_variacoes(familia,dados,'Sabor',lista);
  if (select codigo from public.produto_importacao where produto_id=a) is distinct from 'QA-M'
    or (select codigo from public.produto_importacao where produto_id=b) is not null
    or (select count(*) from public.produto_importacao where produto_id in (a,b) and codigo_pai='QA-PAI')<>2
  then raise exception 'FAIL skus das variações';end if;

  -- Trocar os códigos entre duas variações na mesma gravação
  lista:=jsonb_build_array((lista->0)||'{"codigo":"QA-T"}',(lista->1)||'{"codigo":"QA-M"}');
  perform public.salvar_produto_variacoes(familia,dados,'Sabor',lista);
  if (select codigo from public.produto_importacao where produto_id=a) is distinct from 'QA-T'
    or (select codigo from public.produto_importacao where produto_id=b) is distinct from 'QA-M' then raise exception 'FAIL troca de skus';end if;

  -- Duas variações com o mesmo SKU
  begin
    perform public.salvar_produto_variacoes(familia,dados,'Sabor',jsonb_build_array((lista->0)||'{"codigo":"QA-X"}',(lista->1)||'{"codigo":"qa-x"}'));
    raise exception using errcode='XX000',message='FAIL skus iguais aceitos';
  exception when sqlstate 'P0001' then
    get stacked diagnostics msg = message_text;
    if msg <> 'Há variações com o mesmo SKU.' then raise exception 'FAIL mensagem: %',msg;end if;
  end;

  -- O SKU do produto não vira SKU de variação
  if exists(select 1 from public.produto_importacao where codigo='QA-PAI') then raise exception 'FAIL sku do pai gravado na variação';end if;
end;$test$;
rollback;
select 'PASS: SKU no cadastro (simples, variações, troca, duplicado, apagar, custo preservado). Dados de teste desfeitos.' as resultado;
