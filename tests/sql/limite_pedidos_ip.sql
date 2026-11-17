-- Limite de pedidos por conexão (IP): 5 a cada 10 min, mesmo trocando o telefone.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/limite_pedidos_ip.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  lata uuid := gen_random_uuid();
  n integer := 0;
  i integer;
  msg text;
begin
  -- request.headers simula os cabeçalhos que a API do Supabase repassa ao banco
  update public.configuracoes set status_manual = 'aberta', status_ate = null, pedido_minimo = 0, aceita_retirada = true,
    pagamentos = array['pix', 'dinheiro', 'cartao'] where id = 1;
  insert into public.produtos (id, nome, preco, controla_estoque, unidade_estoque) values (lata, 'QA Lata IP', 500, true, 'un');
  update public.produtos set estoque = 1000 where id = lata;
  delete from privado.pedidos_por_ip;

  -- De onde sai o IP: Cloudflare primeiro; do x-forwarded-for só o último (o começo é falsificável)
  perform set_config('request.headers', '{"cf-connecting-ip": "200.1.1.1", "x-forwarded-for": "1.2.3.4, 200.1.1.1"}', true);
  if privado.ip_cliente() <> '200.1.1.1' then raise exception 'FAIL ip pela Cloudflare'; end if;
  perform set_config('request.headers', '{"x-forwarded-for": "1.2.3.4,  200.9.9.9"}', true);
  if privado.ip_cliente() <> '200.9.9.9' then raise exception 'FAIL ip pelo último do x-forwarded-for: %', privado.ip_cliente(); end if;
  perform set_config('request.headers', '', true);
  if privado.ip_cliente() is not null then raise exception 'FAIL ip sem cabeçalho'; end if;
  -- Rede interna (Supabase local no Docker) e lixo no cabeçalho: sem limite por IP
  perform set_config('request.headers', '{"x-forwarded-for": "172.18.0.1"}', true);
  if privado.ip_cliente() is not null then raise exception 'FAIL ip interno'; end if;
  perform set_config('request.headers', '{"cf-connecting-ip": "nao-e-ip"}', true);
  if privado.ip_cliente() is not null then raise exception 'FAIL ip inválido'; end if;
  perform set_config('request.headers', '{"cf-connecting-ip": "2804:14c:5b:8000::1"}', true);
  if privado.ip_cliente() <> '2804:14c:5b:8000::1' then raise exception 'FAIL ipv6 público'; end if;

  -- 5 pedidos da mesma conexão, cada um com um telefone diferente: passam
  perform set_config('request.headers', '{"cf-connecting-ip": "200.1.1.1"}', true);
  for i in 1..5 loop
    n := n + 1;
    perform set_config('role', 'anon', true);
    perform public.criar_pedido('QA IP', '1191000' || lpad(n::text, 4, '0'), 'retirada', null, null, 'dinheiro', null, null,
      jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
    perform set_config('role', 'postgres', true);
  end loop;

  -- 6º da mesma conexão, com outro telefone: recusa
  n := n + 1;
  perform set_config('role', 'anon', true);
  begin
    perform public.criar_pedido('QA IP', '1191000' || lpad(n::text, 4, '0'), 'retirada', null, null, 'dinheiro', null, null,
      jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
    raise exception 'FAIL 6º pedido da mesma conexão passou';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    if msg not like 'Muitos pedidos seguidos desta conexão%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  -- Outra conexão continua pedindo normalmente
  perform set_config('request.headers', '{"cf-connecting-ip": "200.2.2.2"}', true);
  perform set_config('role', 'anon', true);
  perform public.criar_pedido('QA IP', '11910009999', 'retirada', null, null, 'dinheiro', null, null,
    jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
  perform set_config('role', 'postgres', true);

  -- Só os pedidos aceitos contam: o 6º, recusado, não foi registrado
  if (select count(*) from privado.pedidos_por_ip where ip = '200.1.1.1') <> 5 then raise exception 'FAIL pedido recusado contou no limite'; end if;
  if (select count(*) from privado.pedidos_por_ip where ip = '200.2.2.2') <> 1 then raise exception 'FAIL contagem da 2ª conexão'; end if;

  -- Depois de 10 min a conexão volta a pedir; registros com mais de 1 h são apagados
  update privado.pedidos_por_ip set criado_em = now() - interval '2 hours' where ip = '200.1.1.1';
  perform set_config('request.headers', '{"cf-connecting-ip": "200.1.1.1"}', true);
  perform set_config('role', 'anon', true);
  perform public.criar_pedido('QA IP', '11910008888', 'retirada', null, null, 'dinheiro', null, null,
    jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
  perform set_config('role', 'postgres', true);
  if (select count(*) from privado.pedidos_por_ip where ip = '200.1.1.1') <> 1 then raise exception 'FAIL registros antigos não foram apagados'; end if;

  -- Visitante não lê os IPs
  perform set_config('role', 'anon', true);
  begin
    perform count(*) from privado.pedidos_por_ip;
    raise exception 'FAIL visitante leu os IPs';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
end;
$test$;
rollback;
select 'PASS: 5 pedidos por conexão a cada 10 min mesmo trocando o telefone; IP da Cloudflare, x-forwarded-for falso ignorado; IPs apagados após 1 h e fora do alcance do visitante. Dados desfeitos.' as resultado;
