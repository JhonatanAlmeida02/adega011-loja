-- Pix automático: valor sempre do banco, confirmação só com dados que batem,
-- aviso repetido não muda nada, Pix vencido cancela e devolve o estoque.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/pix_mercadopago.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  lata uuid := gen_random_uuid(); admin_id uuid := (select user_id from public.admins limit 1); r jsonb; pedido uuid; pedido2 uuid; n text; msg text; total integer;
begin
  update public.configuracoes set status_manual = 'aberta', pedido_minimo = 0, aceita_retirada = true,
    pagamentos = array['pix', 'dinheiro', 'cartao'], pix_online = true where id = 1;
  insert into public.produtos (id, nome, preco, controla_estoque, unidade_estoque) values (lata, 'QA Lata Pix', 500, true, 'un');
  update public.produtos set estoque = 10 where id = lata;

  -- Visitante faz o pedido por Pix
  perform set_config('role', 'anon', true);
  r := public.criar_pedido('QA Pix', '11999990001', 'retirada', null, null, 'pix', null, null,
    jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 2)));
  pedido := (r ->> 'id')::uuid; total := (r ->> 'total')::integer;
  -- Visitante não aplica pagamento nem prepara cobrança
  begin
    perform public.pix_aplicar('x', pedido, 'approved', total, 'BRL');
    raise exception using errcode = 'XX000', message = 'FAIL visitante aplicou pagamento';
  exception when insufficient_privilege then null; end;
  begin
    perform public.pix_preparar(pedido);
    raise exception using errcode = 'XX000', message = 'FAIL visitante preparou cobrança';
  exception when insufficient_privilege then null; end;
  if public.status_pix(pedido) is not null then raise exception 'FAIL status sem cobrança'; end if;
  perform set_config('role', 'postgres', true);

  -- Edge Function (chave de serviço): prepara com o total do banco e registra
  r := public.pix_preparar(pedido);
  if (r #>> '{pedido,total}')::integer <> 1000 then raise exception 'FAIL total do banco: %', r; end if;
  begin
    perform public.pix_registrar(pedido, 'mp-1', 1, 'qr', 'b64', now() + interval '30 minutes');
    raise exception using errcode = 'XX000', message = 'FAIL cobrança com valor diferente aceita';
  exception when sqlstate 'P0001' then null; end;
  perform public.pix_registrar(pedido, 'mp-1', 1000, 'qr-copia-cola', 'b64', now() + interval '30 minutes');
  perform public.pix_registrar(pedido, 'mp-1', 1000, 'qr-copia-cola', 'b64', now() + interval '30 minutes'); -- repetido: nada muda
  if (public.pix_preparar(pedido) #>> '{existente,id_externo}') <> 'mp-1' then raise exception 'FAIL segunda cobrança para o mesmo pedido'; end if;

  -- Visitante vê o QR do próprio pedido
  perform set_config('role', 'anon', true);
  r := public.status_pix(pedido);
  if r ->> 'status' <> 'pendente' or r ->> 'qr_code' <> 'qr-copia-cola' or (r ->> 'valor')::integer <> 1000 then raise exception 'FAIL status para o cliente: %', r; end if;
  perform set_config('role', 'postgres', true);

  -- Aviso que não bate (valor, referência, moeda) não paga
  if public.pix_aplicar('mp-1', pedido, 'approved', 999, 'BRL') <> 'divergente' then raise exception 'FAIL valor diferente'; end if;
  if (select pagamento_status from public.pedidos where id = pedido) is not null and (select pagamento_status from public.pedidos where id = pedido) = 'pago' then raise exception 'FAIL pago com valor errado'; end if;
  update public.pagamentos set status = 'pendente' where id_externo = 'mp-1';
  if public.pix_aplicar('mp-1', gen_random_uuid(), 'approved', 1000, 'BRL') <> 'divergente' then raise exception 'FAIL referência diferente'; end if;
  update public.pagamentos set status = 'pendente' where id_externo = 'mp-1';
  if public.pix_aplicar('mp-1', pedido, 'approved', 1000, 'USD') <> 'divergente' then raise exception 'FAIL moeda diferente'; end if;
  update public.pagamentos set status = 'pendente' where id_externo = 'mp-1';
  if public.pix_aplicar('nao-existe', pedido, 'approved', 1000, 'BRL') <> 'desconhecido' then raise exception 'FAIL cobrança desconhecida'; end if;

  -- Aprovado: paga; repetir não muda; "cancelado" depois de pago não desfaz
  if public.pix_aplicar('mp-1', pedido, 'approved', 1000, 'BRL') <> 'pago' then raise exception 'FAIL aprovar'; end if;
  if public.pix_aplicar('mp-1', pedido, 'approved', 1000, 'BRL') <> 'pago' then raise exception 'FAIL aprovar de novo'; end if;
  if public.pix_aplicar('mp-1', pedido, 'cancelled', 1000, 'BRL') <> 'pago' then raise exception 'FAIL cancelado desfez pago'; end if;
  if (select pagamento_status from public.pedidos where id = pedido) <> 'pago' or (select pago_em from public.pagamentos where id_externo = 'mp-1') is null
    then raise exception 'FAIL pedido não ficou pago'; end if;
  if (select status from public.pedidos where id = pedido) <> 'novo' then raise exception 'FAIL pago mudou o status do pedido'; end if;
  -- Estorno pelo painel: visitante não; admin recebe o id e o valor total
  perform set_config('role', 'anon', true);
  begin
    perform public.pix_para_estorno(pedido);
    raise exception using errcode = 'XX000', message = 'FAIL visitante pediu estorno';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.pix_para_estorno(pedido);
    raise exception using errcode = 'XX000', message = 'FAIL logado sem ser admin pediu estorno';
  exception when sqlstate 'P0001' or insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  r := public.pix_para_estorno(pedido);
  if r ->> 'id_externo' <> 'mp-1' or (r ->> 'valor')::integer <> 1000 then raise exception 'FAIL dados do estorno: %', r; end if;
  perform set_config('role', 'postgres', true);
  if public.pix_aplicar('mp-1', pedido, 'refunded', 1000, 'BRL') <> 'estornado' then raise exception 'FAIL estorno'; end if;
  -- Já estornado: não estorna de novo
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin
    perform public.pix_para_estorno(pedido);
    raise exception using errcode = 'XX000', message = 'FAIL estorno duplicado';
  exception when sqlstate 'P0001' then null; end;

  -- Pix vencido: cancela o pedido novo e devolve o estoque
  r := public.criar_pedido('QA Pix 2', '11999990002', 'retirada', null, null, 'pix', null, null,
    jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 3)));
  pedido2 := (r ->> 'id')::uuid;
  if (select estoque from public.produtos where id = lata) <> 5 then raise exception 'FAIL baixa do estoque'; end if;
  perform public.pix_registrar(pedido2, 'mp-2', 1500, 'qr2', 'b64', now() - interval '10 minutes');
  if not exists (select 1 from public.pix_vencidos() where id_externo = 'mp-2') then raise exception 'FAIL vencido não listado'; end if;
  begin
    perform public.pix_preparar(pedido2);
    raise exception using errcode = 'XX000', message = 'FAIL nova cobrança para Pix vencido';
  exception when sqlstate 'P0001' then
    get stacked diagnostics msg = message_text;
    if msg not like 'O Pix deste pedido venceu%' then raise exception 'FAIL mensagem: %', msg; end if;
  end;
  if public.pix_aplicar('mp-2', pedido2, 'cancelled', 1500, 'BRL') <> 'expirado' then raise exception 'FAIL expirar'; end if;
  if (select status from public.pedidos where id = pedido2) <> 'cancelado' then raise exception 'FAIL pedido vencido não cancelado'; end if;
  if (select estoque from public.produtos where id = lata) <> 8 then raise exception 'FAIL estoque não voltou: %', (select estoque from public.produtos where id = lata); end if;

  -- Pedido que não é Pix e Pix online desligado
  r := public.criar_pedido('QA Dinheiro', '11999990003', 'retirada', null, null, 'dinheiro', null, null,
    jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
  begin
    perform public.pix_preparar((r ->> 'id')::uuid);
    raise exception using errcode = 'XX000', message = 'FAIL Pix para pedido em dinheiro';
  exception when sqlstate 'P0001' then null; end;
  update public.configuracoes set pix_online = false where id = 1;
  begin
    perform public.pix_preparar(pedido);
    raise exception using errcode = 'XX000', message = 'FAIL Pix com a opção desligada';
  exception when sqlstate 'P0001' then null; end;
end;
$test$;
rollback;
select 'PASS: Pix com total do banco, uma cobrança por pedido, confirmação só quando referência/valor/moeda batem, aviso repetido sem efeito, estorno, vencido cancela e devolve estoque, visitante sem acesso às funções internas, estorno só por admin e só uma vez. Dados desfeitos.' as resultado;
