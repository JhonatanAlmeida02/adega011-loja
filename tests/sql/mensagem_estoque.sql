-- Mensagens de falta de estoque na unidade de venda (garrafa, pacote, kit).
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/mensagem_estoque.sql
begin;
set local statement_timeout='25s';
do $test$
declare
  vodka uuid:=gen_random_uuid(); gelo uuid:=gen_random_uuid(); copao uuid:=gen_random_uuid();
  lata uuid:=gen_random_uuid(); fardo uuid:=gen_random_uuid(); admin_id uuid; msg text; r jsonb; caso text;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.configuracoes set status_manual='aberta',aceita_retirada=true,pedido_minimo=0,pagamentos=array['pix','dinheiro','cartao'] where id=1;
  insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,volume_unidade) values
    (vodka,'QA Vodka 1L',5000,true,'ml',1000),(gelo,'QA Gelo',800,true,'un',1),(lata,'QA Lata',400,true,'un',1);
  insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,unidades_pacote,vende_pacote)
    values (fardo,'QA Fardo 15',5000,true,'un',15,true);
  insert into public.produtos(id,nome,preco,eh_kit) values (copao,'QA Copão',2000,true);
  insert into public.kit_componentes values (copao,gelo,1);
  perform public.ajustar_estoque(vodka,'entrada',1500);
  perform public.ajustar_estoque(gelo,'entrada',3);
  perform public.ajustar_estoque(fardo,'entrada',20);

  -- cada caso: itens do carrinho e a mensagem esperada (null = pedido aceito)
  for caso in
    select format('%s|%s', itens, coalesce(esperado,'')) from (values
      (jsonb_build_array(jsonb_build_object('produto_id',vodka,'quantidade',2)), 'QA Vodka 1L · só temos 1 em estoque.'),
      (jsonb_build_array(jsonb_build_object('produto_id',copao,'quantidade',4)), 'QA Copão · só temos 3 em estoque.'),
      (jsonb_build_array(jsonb_build_object('produto_id',copao,'quantidade',2),jsonb_build_object('produto_id',gelo,'quantidade',2)),
        'Não temos estoque para todos esses itens juntos (QA Copão e outro item usam o mesmo produto). Diminua a quantidade.'),
      (jsonb_build_array(jsonb_build_object('produto_id',fardo,'quantidade',2)), 'QA Fardo 15 · só temos 1 em estoque.'),
      (jsonb_build_array(jsonb_build_object('produto_id',lata,'quantidade',1)), 'QA Lata está esgotado.'),
      (jsonb_build_array(jsonb_build_object('produto_id',vodka,'quantidade',1),jsonb_build_object('produto_id',copao,'quantidade',3)), null)
    ) as t(itens, esperado)
  loop
    msg := null;
    begin
      r := public.criar_pedido('QA','1199'||lpad((random()*9999999)::int::text,7,'0'),'retirada',null,null,'pix',null,null,
        split_part(caso,'|',1)::jsonb);
      raise exception 'QA_DESFAZ';
    exception when others then
      if sqlerrm <> 'QA_DESFAZ' then msg := sqlerrm; end if;
    end;
    if coalesce(msg,'') <> split_part(caso,'|',2) then
      raise exception 'Esperado "%", veio "%"', split_part(caso,'|',2), coalesce(msg,'(pedido aceito)');
    end if;
  end loop;

  -- Nenhuma tentativa recusada mexeu no estoque
  if (select estoque from public.produtos where id=vodka) <> 1500 or (select estoque from public.produtos where id=gelo) <> 3 then
    raise exception 'Estoque mudou após pedidos recusados';
  end if;
end;
$test$;
select 'PASS: mensagens na unidade de venda (ml, pacote, kit, estoque compartilhado, esgotado) e nada baixado nas recusas. Fixtures rolled back.';
rollback;
