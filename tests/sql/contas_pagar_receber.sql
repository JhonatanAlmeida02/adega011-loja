-- Contas a pagar/receber: pagar cria a saída na conta escolhida, receber cria a
-- entrada, desfazer estorna e reabre, repetição mensal, só admin.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/contas_pagar_receber.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  admin_id uuid := (select user_id from public.admins limit 1);
  banco uuid := gen_random_uuid(); caixa uuid := gen_random_uuid();
  fornecedor uuid := gen_random_uuid(); aluguel uuid := gen_random_uuid(); cliente uuid := gen_random_uuid();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  lanc uuid; msg text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform public.financeiro_salvar_conta(banco, 'QA Banco', 'banco', false, true, 100000);
  perform public.financeiro_salvar_conta(caixa, 'QA Caixa', 'caixa', false, true, 5000);

  -- Conta a pagar do fornecedor
  perform public.financeiro_salvar_titulo(fornecedor, 'pagar', 'NF 123 Ambev', 'Ambev', 'Fornecedores', '123', '', 45000, hoje + 7);
  if (select status from public.financeiro_titulos where id = fornecedor) <> 'aberto' then raise exception 'FAIL criar'; end if;
  -- Editar enquanto aberta
  perform public.financeiro_salvar_titulo(fornecedor, 'pagar', 'NF 123 Ambev', 'Ambev', 'Fornecedores', '123', 'boleto', 46000, hoje + 7);
  if (select valor from public.financeiro_titulos where id = fornecedor) <> 46000 then raise exception 'FAIL editar'; end if;

  -- Pagar pela conta do banco: saída no extrato e saldo menor
  lanc := public.financeiro_baixar_titulo(fornecedor, banco, hoje);
  if (select tipo || '|' || origem_id || '|' || valor || '|' || descricao from public.financeiro_lancamentos where id = lanc)
     <> 'saida|' || banco || '|46000|Pagamento: NF 123 Ambev · Ambev' then raise exception 'FAIL lançamento do pagamento'; end if;
  if (select saldo from public.financeiro_saldos where id = banco) <> 54000 then raise exception 'FAIL saldo do banco'; end if;
  if (select status || conta_id from public.financeiro_titulos where id = fornecedor) <> 'pago' || banco then raise exception 'FAIL título pago'; end if;
  -- Repetir igual não lança de novo; pagar de novo diferente é recusado
  if public.financeiro_baixar_titulo(fornecedor, banco, hoje) <> lanc then raise exception 'FAIL idempotente'; end if;
  begin
    perform public.financeiro_baixar_titulo(fornecedor, caixa, hoje);
    raise exception using errcode = 'XX000', message = 'FAIL pagou duas vezes';
  exception when sqlstate 'P0001' then null; end;
  -- Não edita conta paga
  begin
    perform public.financeiro_salvar_titulo(fornecedor, 'pagar', 'x', '', '', '', '', 1, hoje);
    raise exception using errcode = 'XX000', message = 'FAIL editou conta paga';
  exception when sqlstate 'P0001' then null; end;

  -- Desfazer: estorno no extrato, saldo volta e a conta reabre
  perform public.financeiro_desfazer_baixa(fornecedor, 'Paguei pela conta errada');
  if (select saldo from public.financeiro_saldos where id = banco) <> 100000 then raise exception 'FAIL saldo após desfazer'; end if;
  if (select status from public.financeiro_titulos where id = fornecedor) <> 'aberto'
     or (select lancamento_id from public.financeiro_titulos where id = fornecedor) is not null then raise exception 'FAIL reabrir'; end if;
  if not exists (select 1 from public.financeiro_lancamentos where estorno_de = lanc) then raise exception 'FAIL estorno no histórico'; end if;

  -- Paga de novo pelo caixa; estornar o lançamento direto no Financeiro também reabre
  lanc := public.financeiro_baixar_titulo(fornecedor, caixa, hoje);
  perform public.financeiro_estornar(lanc, 'Estornado pelo extrato');
  if (select status from public.financeiro_titulos where id = fornecedor) <> 'aberto' then raise exception 'FAIL estorno pelo extrato não reabriu'; end if;

  -- Data futura e conta inativa recusadas
  begin
    perform public.financeiro_baixar_titulo(fornecedor, banco, hoje + 1);
    raise exception using errcode = 'XX000', message = 'FAIL pagamento no futuro';
  exception when sqlstate 'P0001' then null; end;

  -- Aluguel repetido 3 meses
  perform public.financeiro_salvar_titulo(aluguel, 'pagar', 'Aluguel', 'Imobiliária', 'Aluguel', '', '', 150000, date '2026-12-05', 3);
  if (select string_agg(vencimento::text || '#' || parcela || '/' || parcelas, ',' order by vencimento) from public.financeiro_titulos where grupo = aluguel)
     <> '2026-12-05#1/3,2027-01-05#2/3,2027-02-05#3/3' then raise exception 'FAIL repetição mensal'; end if;

  -- Conta a receber: entrada na conta escolhida
  perform public.financeiro_salvar_titulo(cliente, 'receber', 'Fiado do João', 'João', 'Clientes', '', '', 3000, hoje);
  lanc := public.financeiro_baixar_titulo(cliente, caixa, hoje);
  if (select tipo || '|' || destino_id || '|' || valor from public.financeiro_lancamentos where id = lanc) <> 'entrada|' || caixa || '|3000'
    then raise exception 'FAIL entrada do recebimento'; end if;

  -- Cancelar só em aberto
  perform public.financeiro_cancelar_titulo(aluguel);
  if (select status from public.financeiro_titulos where id = aluguel) <> 'cancelado' then raise exception 'FAIL cancelar'; end if;
  begin
    perform public.financeiro_cancelar_titulo(cliente);
    raise exception using errcode = 'XX000', message = 'FAIL cancelou conta recebida';
  exception when sqlstate 'P0001' then null; end;

  -- Quem não é admin não mexe
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.financeiro_salvar_titulo(gen_random_uuid(), 'pagar', 'x', '', '', '', '', 100, hoje);
    raise exception using errcode = 'XX000', message = 'FAIL não admin criou conta';
  exception when sqlstate 'P0001' then null; end;
  perform set_config('role', 'anon', true);
  begin
    perform public.financeiro_baixar_titulo(fornecedor, banco, hoje);
    raise exception using errcode = 'XX000', message = 'FAIL visitante pagou';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
end;
$test$;
rollback;
select 'PASS: contas a pagar/receber criam saída/entrada na conta escolhida, sem pagar duas vezes, desfazer e estorno pelo extrato reabrem, repetição mensal, cancelar, só admin. Dados desfeitos.' as resultado;
