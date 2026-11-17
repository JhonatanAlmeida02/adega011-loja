-- Forçar aberta/fechada com prazo e horário conferido no pedido (criar_pedido).
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/loja_aberta_ate.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  lata uuid := gen_random_uuid();
  -- Os horários são montados em volta do relógio real, porque criar_pedido usa now().
  sempre_aberta jsonb := (select jsonb_object_agg(d::text, '[{"abre":"00:00","fecha":"00:00"}]'::jsonb) from generate_series(0, 6) d);
  sempre_fechada jsonb := '{}'::jsonb;
  n integer := 0;
  caso record;
  aceitou boolean;
  msg text;
begin
  update public.configuracoes set status_manual = 'auto', status_ate = null, pedido_minimo = 0, aceita_retirada = true,
    pagamentos = array['pix', 'dinheiro', 'cartao'] where id = 1;
  insert into public.produtos (id, nome, preco, controla_estoque, unidade_estoque) values (lata, 'QA Lata Horário', 500, true, 'un');
  update public.produtos set estoque = 100 where id = lata;

  for caso in select * from (values
    ('auto',    null::interval,          'fechada', false, 'automático fora do horário recusa'),
    ('auto',    null,                    'aberta',  true,  'automático no horário aceita'),
    ('aberta',  interval '1 hour',       'fechada', true,  'forçada aberta com prazo aceita fora do horário'),
    ('aberta',  null,                    'fechada', true,  'forçada aberta sem prazo aceita'),
    ('aberta',  interval '-5 minutes',   'fechada', true,  'prazo da aberta venceu há 5 min: tolerância aceita'),
    ('aberta',  interval '-11 minutes',  'fechada', false, 'prazo da aberta venceu há 11 min: volta ao horário e recusa'),
    ('fechada', null,                    'aberta',  false, 'forçada fechada sem prazo recusa mesmo no horário'),
    ('fechada', interval '2 hours',      'aberta',  false, 'forçada fechada com prazo recusa até o prazo'),
    ('fechada', interval '-1 minute',    'aberta',  true,  'prazo da fechada venceu: volta ao horário e aceita')
  ) v(modo, prazo, horario, esperado, nome) loop
    n := n + 1;
    update public.configuracoes
       set status_manual = caso.modo, status_ate = now() + caso.prazo,
           horarios = case when caso.horario = 'aberta' then sempre_aberta else sempre_fechada end
     where id = 1;
    perform set_config('role', 'anon', true);
    begin
      perform public.criar_pedido('QA Horário', '1190000' || lpad(n::text, 4, '0'), 'retirada', null, null, 'dinheiro', null, null,
        jsonb_build_array(jsonb_build_object('produto_id', lata, 'quantidade', 1)));
      aceitou := true;
    exception when raise_exception then
      get stacked diagnostics msg = message_text;
      if msg <> 'A loja está fechada no momento.' then raise exception 'FAIL % (erro inesperado: %)', caso.nome, msg; end if;
      aceitou := false;
    end;
    perform set_config('role', 'postgres', true);
    if aceitou is distinct from caso.esperado then raise exception 'FAIL %', caso.nome; end if;
  end loop;

  -- Modo num instante: o prazo vencido vira automático
  update public.configuracoes set status_manual = 'aberta', status_ate = '2026-11-16 12:00-03', horarios = sempre_fechada where id = 1;
  if privado.modo_loja('2026-11-16 11:59-03') <> 'aberta' then raise exception 'FAIL modo antes do prazo'; end if;
  if privado.modo_loja('2026-11-16 12:00-03') <> 'auto' then raise exception 'FAIL modo no prazo'; end if;
  -- Forçada aberta mantém o site acordado mesmo fora do horário
  if not privado.loja_no_horario(p_agora => '2026-11-16 11:00-03') then raise exception 'FAIL aberta não mantém acordado'; end if;
  if privado.loja_no_horario(p_agora => '2026-11-16 12:30-03') then raise exception 'FAIL prazo vencido ainda acordado'; end if;

  -- Automático não tem prazo
  begin
    update public.configuracoes set status_manual = 'auto', status_ate = now() where id = 1;
    raise exception 'FAIL automático aceitou prazo';
  exception when check_violation then null; end;

  -- Visitante não chama as funções internas
  perform set_config('role', 'anon', true);
  begin
    perform privado.modo_loja();
    raise exception 'FAIL visitante leu o modo interno';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
end;
$test$;
rollback;
select 'PASS: automático confere o horário; forçada aberta/fechada com e sem prazo, prazo vencido volta ao automático, 10 min de tolerância. Dados desfeitos.' as resultado;
