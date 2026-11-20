-- Sangria sai da conta do caixa (saída ou transferência); reforço vem da conta escolhida
-- (transferência) ou de fora (entrada). Rode: psql -v ON_ERROR_STOP=1 -f tests/sql/caixa_movimentos_financeiro.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  admin_id uuid := (select user_id from public.admins where papel = 'admin' limit 1);
  banco uuid := gen_random_uuid(); gaveta uuid := gen_random_uuid(); reserva uuid := gen_random_uuid();
  r jsonb; l public.financeiro_lancamentos%rowtype;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  update public.caixas set fechado_em = now() where fechado_em is null;
  perform public.financeiro_salvar_conta(banco, 'QA Banco', 'banco', true, true, 100000);
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta', 'caixa', false, true, 20000, true);
  perform public.financeiro_salvar_conta(reserva, 'QA Reserva', 'caixa', false, true, 50000);

  r := public.contas_reforco_caixa();
  if r #>> '{gaveta,nome}' <> 'QA Gaveta' or exists (select 1 from jsonb_array_elements(r -> 'contas') e where e ->> 'id' = gaveta::text)
     or (r #>> '{contas,0,tipo}') <> 'caixa' then raise exception 'FAIL contas do reforço: %', r; end if;

  perform public.abrir_caixa(0);
  -- Sangria sem destino: saída da gaveta
  perform public.movimentar_caixa('sangria', 3000, 'gelo');
  select * into l from public.financeiro_lancamentos where id = (select lancamento_id from public.caixa_movimentos where descricao = 'gelo');
  if l.tipo <> 'saida' or l.origem_id <> gaveta or l.valor <> 3000 or l.descricao <> 'Sangria do caixa · gelo' then raise exception 'FAIL sangria saída: %', row_to_json(l); end if;
  -- Sangria para o banco: transferência
  perform public.movimentar_caixa('sangria', 10000, 'depósito', banco);
  select * into l from public.financeiro_lancamentos where id = (select lancamento_id from public.caixa_movimentos where descricao = 'depósito');
  if l.tipo <> 'transferencia' or l.origem_id <> gaveta or l.destino_id <> banco then raise exception 'FAIL sangria para o banco'; end if;
  -- Reforço vindo da reserva: transferência para a gaveta
  perform public.movimentar_caixa('suprimento', 5000, 'troco', reserva);
  select * into l from public.financeiro_lancamentos where id = (select lancamento_id from public.caixa_movimentos where descricao = 'troco');
  if l.tipo <> 'transferencia' or l.origem_id <> reserva or l.destino_id <> gaveta or l.descricao <> 'Reforço do caixa (de QA Reserva) · troco' then raise exception 'FAIL reforço da reserva'; end if;
  -- Reforço de fora: entrada
  perform public.movimentar_caixa('suprimento', 2000, 'do bolso');
  select * into l from public.financeiro_lancamentos where id = (select lancamento_id from public.caixa_movimentos where descricao = 'do bolso');
  if l.tipo <> 'entrada' or l.destino_id <> gaveta then raise exception 'FAIL reforço de fora'; end if;
  -- Saldos: gaveta 200 - 30 - 100 + 50 + 20 = 140; banco 1000 + 100; reserva 500 - 50
  if (select saldo from public.financeiro_saldos where id = gaveta) <> 14000
     or (select saldo from public.financeiro_saldos where id = banco) <> 110000
     or (select saldo from public.financeiro_saldos where id = reserva) <> 45000 then raise exception 'FAIL saldos'; end if;
  -- Não pode a própria gaveta nem conta inativa
  begin
    perform public.movimentar_caixa('suprimento', 100, null, gaveta);
    raise exception using errcode = 'XX000', message = 'FAIL reforço da própria gaveta';
  exception when sqlstate 'P0001' then null; end;
  -- O caixa continua contando certo (troco 0 - 30 - 100 + 50 + 20 = -60)
  if (public.resumo_caixa(null) ->> 'sangrias')::int <> 13000 or (public.resumo_caixa(null) ->> 'suprimentos')::int <> 7000 then raise exception 'FAIL resumo do caixa'; end if;
  -- Sem conta do caixa: a sangria sai da conta padrão para vendas
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta', 'caixa', false, true, 0, false);
  perform public.movimentar_caixa('sangria', 500, 'sem gaveta');
  if (select origem_id from public.financeiro_lancamentos where id = (select lancamento_id from public.caixa_movimentos where descricao = 'sem gaveta')) <> banco then raise exception 'FAIL fallback padrão'; end if;
end;
$test$;
rollback;
select 'PASS: sangria sai da conta do caixa (saída ou transferência), reforço vem da conta escolhida (transferência) ou de fora (entrada), saldos certos, sem a própria gaveta, resumo do caixa igual. Dados desfeitos.' as resultado;
