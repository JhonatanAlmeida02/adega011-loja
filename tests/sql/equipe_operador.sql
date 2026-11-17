-- Equipe: administrador vê tudo; operador só Pedidos e PDV; cadastro só pelo admin.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/equipe_operador.sql
begin;
set local statement_timeout = '25s';

-- Login de teste do operador
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'operador.qa@adega.local', '', now(), now(), now(), '{}', '{}'),
       ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'outro.qa@adega.local', '', now(), now(), now(), '{}', '{}');
create temp table qa (chave text primary key, valor text);
grant all on qa to authenticated;
insert into qa values ('admin', (select user_id::text from public.admins where papel = 'admin' limit 1));
insert into qa select 'pedido', id::text from public.pedidos order by criado_em desc limit 1;

do $test$
declare
  admin_id uuid := (select valor::uuid from qa where chave = 'admin');
  operador uuid := '00000000-0000-4000-8000-0000000000aa';
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.is_admin() or not public.is_equipe() then raise exception 'FAIL admin'; end if;

  -- Admin cadastra o operador (o login já existe; a Edge Function cria antes)
  if public.equipe_vincular('Operador.QA@adega.local', 'Maria', 'operador') <> operador then raise exception 'FAIL vincular'; end if;
  if (select papel || '|' || nome from public.admins where user_id = operador) <> 'operador|Maria' then raise exception 'FAIL papel salvo'; end if;
  if not exists (select 1 from public.equipe_listar() where user_id = operador and email = 'operador.qa@adega.local') then raise exception 'FAIL listar'; end if;
  if not public.equipe_membro(operador) or public.equipe_membro('00000000-0000-4000-8000-0000000000bb') then raise exception 'FAIL membro'; end if;
  begin
    perform public.equipe_vincular('operador.qa@adega.local', 'Maria', 'operador');
    raise exception using errcode = 'XX000', message = 'FAIL vinculou duas vezes';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.equipe_vincular('ninguem@adega.local', 'X', 'operador');
    raise exception using errcode = 'XX000', message = 'FAIL vinculou e-mail sem login';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.equipe_vincular('outro.qa@adega.local', 'X', 'dono');
    raise exception using errcode = 'XX000', message = 'FAIL papel inválido';
  exception when sqlstate 'P0001' then null; end;
  -- Não fica sem administrador; não tira o próprio acesso
  begin
    perform public.equipe_salvar(admin_id, 'Dono', 'operador');
    raise exception using errcode = 'XX000', message = 'FAIL ficou sem admin';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.equipe_remover(admin_id);
    raise exception using errcode = 'XX000', message = 'FAIL removeu a si mesmo';
  exception when sqlstate 'P0001' then null; end;
  perform public.equipe_salvar(operador, 'Maria Souza', 'operador');

  -- Como operador
  perform set_config('request.jwt.claims', jsonb_build_object('sub', operador, 'role', 'authenticated')::text, true);
  if public.is_admin() or not public.is_equipe() then raise exception 'FAIL operador é equipe e não admin'; end if;
  perform public.resumo_caixa(null);               -- PDV/caixa liberado
  perform * from public.saldos_venda();
  begin
    perform * from public.relatorio_vendas(current_date - 7, current_date);
    raise exception using errcode = 'XX000', message = 'FAIL operador viu relatório';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.financeiro_painel();
    raise exception using errcode = 'XX000', message = 'FAIL operador viu financeiro';
  exception when sqlstate 'P0001' then null; when undefined_function then null; end;
  begin
    perform * from public.equipe_listar();
    raise exception using errcode = 'XX000', message = 'FAIL operador listou equipe';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.equipe_salvar(operador, 'Maria', 'admin');
    raise exception using errcode = 'XX000', message = 'FAIL operador virou admin';
  exception when sqlstate 'P0001' then null; end;
end;
$test$;

-- RLS pela API: o operador lê pedidos e produtos ocultos, muda só o status
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
do $test$
declare
  pedido uuid := (select valor::uuid from qa where chave = 'pedido');
  st text;
begin
  if (select count(*) from public.pedidos) = 0 and pedido is not null then raise exception 'FAIL operador não vê pedidos'; end if;
  if (select count(*) from public.produtos) < (select count(*) from public.produtos where ativo) then raise exception 'FAIL produtos'; end if;
  if (select count(*) from public.financeiro_lancamentos) > 0 then raise exception 'FAIL operador vê extrato'; end if;
  if exists (select 1 from public.admins where user_id <> '00000000-0000-4000-8000-0000000000aa') then raise exception 'FAIL operador vê a equipe'; end if;
  if pedido is not null then
    select status into st from public.pedidos where id = pedido;
    update public.pedidos set status = status where id = pedido;   -- só status: pode
    begin
      update public.pedidos set observacoes = observacoes || ' x' where id = pedido;
      raise exception using errcode = 'XX000', message = 'FAIL operador mudou outro campo';
    exception when insufficient_privilege then null; end;
    delete from public.pedidos where id = pedido;                  -- apagar: não (RLS ignora)
    if not exists (select 1 from public.pedidos where id = pedido) then raise exception 'FAIL operador apagou pedido'; end if;
  end if;
end;
$test$;
reset role;

-- Visitante não chama nada da equipe
set local role anon;
do $test$
begin
  begin
    perform * from public.equipe_listar();
    raise exception using errcode = 'XX000', message = 'FAIL visitante';
  exception when insufficient_privilege then null; end;
end;
$test$;
reset role;

-- Admin tira o acesso do operador
select set_config('request.jwt.claims', jsonb_build_object('sub', (select valor from qa where chave = 'admin'), 'role', 'authenticated')::text, true);
select public.equipe_remover('00000000-0000-4000-8000-0000000000aa');
do $test$ begin
  if exists (select 1 from public.admins where user_id = '00000000-0000-4000-8000-0000000000aa') then raise exception 'FAIL remover'; end if;
end $test$;
rollback;
select 'PASS: equipe com admin e operador; operador só pedidos (status) e PDV; cadastro só pelo admin; sempre um admin. Dados desfeitos.' as resultado;
