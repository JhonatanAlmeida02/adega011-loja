-- Contas a pagar e contas a receber, ligadas ao financeiro.
--
-- Um título é uma conta a pagar (fornecedor, aluguel…) ou a receber (cliente
-- que vai pagar depois). Ao pagar/receber, escolhe-se a conta financeira
-- (banco, caixa…) e o sistema cria a saída/entrada no extrato dela
-- (financeiro_lancamentos): o saldo muda sozinho.
--
-- Desfazer um pagamento usa o estorno do financeiro (o histórico fica). Se o
-- lançamento do pagamento for estornado direto no Financeiro, o título volta a
-- ficar em aberto (gatilho abaixo), para nunca ficar "pago" sem dinheiro.

create table public.financeiro_titulos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pagar', 'receber')),
  descricao text not null check (char_length(btrim(descricao)) between 1 and 200),
  pessoa text not null default '' check (char_length(pessoa) <= 120),
  categoria text not null default '' check (char_length(categoria) <= 80),
  documento text not null default '' check (char_length(documento) <= 60),
  observacoes text not null default '' check (char_length(observacoes) <= 500),
  valor bigint not null check (valor > 0 and valor <= 1000000000000),
  vencimento date not null,
  status text not null default 'aberto' check (status in ('aberto', 'pago', 'cancelado')),
  pago_em date,
  conta_id uuid references public.financeiro_contas(id),
  lancamento_id uuid unique references public.financeiro_lancamentos(id),
  -- Repetição mensal: mesmo grupo, parcela n de N
  grupo uuid,
  parcela integer check (parcela between 1 and 60),
  parcelas integer check (parcelas between 1 and 60),
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  check ((status = 'pago') = (lancamento_id is not null and conta_id is not null and pago_em is not null))
);
create index financeiro_titulos_vencimento on public.financeiro_titulos (tipo, status, vencimento);
create index financeiro_titulos_grupo on public.financeiro_titulos (grupo);

alter table public.financeiro_titulos enable row level security;
revoke all on public.financeiro_titulos from public, anon, authenticated;
grant select on public.financeiro_titulos to authenticated;
create policy financeiro_titulos_admin on public.financeiro_titulos for select to authenticated using ((select public.is_admin()));

/** Cria ou edita uma conta a pagar/receber (em aberto). Com p_repetir > 1, cria uma por mês. */
create function public.financeiro_salvar_titulo(
  p_id uuid, p_tipo text, p_descricao text, p_pessoa text, p_categoria text,
  p_documento text, p_observacoes text, p_valor bigint, p_vencimento date, p_repetir integer default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual public.financeiro_titulos%rowtype;
  i integer;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011012);
  if p_id is null or p_tipo is null or p_tipo not in ('pagar', 'receber')
     or p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 200
     or char_length(coalesce(p_pessoa, '')) > 120 or char_length(coalesce(p_categoria, '')) > 80
     or char_length(coalesce(p_documento, '')) > 60 or char_length(coalesce(p_observacoes, '')) > 500
     or p_valor is null or p_valor not between 1 and 1000000000000 or p_vencimento is null
     or p_repetir is null or p_repetir not between 1 and 60 then
    raise exception 'Confira descrição, valor e vencimento.';
  end if;

  select * into atual from public.financeiro_titulos where id = p_id for update;
  if found then
    if atual.tipo <> p_tipo then raise exception 'Esta conta é de outro tipo.'; end if;
    if atual.status <> 'aberto' then raise exception 'Só dá para editar uma conta em aberto. Desfaça o pagamento antes.'; end if;
    update public.financeiro_titulos
       set descricao = btrim(p_descricao), pessoa = btrim(coalesce(p_pessoa, '')), categoria = btrim(coalesce(p_categoria, '')),
           documento = btrim(coalesce(p_documento, '')), observacoes = btrim(coalesce(p_observacoes, '')),
           valor = p_valor, vencimento = p_vencimento, atualizado_em = now()
     where id = p_id;
    return p_id;
  end if;

  for i in 1..p_repetir loop
    insert into public.financeiro_titulos (id, tipo, descricao, pessoa, categoria, documento, observacoes, valor, vencimento, grupo, parcela, parcelas)
    values (case when i = 1 then p_id else gen_random_uuid() end, p_tipo, btrim(p_descricao), btrim(coalesce(p_pessoa, '')),
            btrim(coalesce(p_categoria, '')), btrim(coalesce(p_documento, '')), btrim(coalesce(p_observacoes, '')),
            p_valor, (p_vencimento + make_interval(months => i - 1))::date,
            case when p_repetir > 1 then p_id end, case when p_repetir > 1 then i end, case when p_repetir > 1 then p_repetir end);
  end loop;
  return p_id;
end;
$$;

/**
 * Paga (conta a pagar) ou recebe (conta a receber) usando a conta financeira
 * escolhida: cria a saída/entrada no extrato e marca o título como pago.
 * Repetir com os mesmos dados não lança de novo.
 */
create function public.financeiro_baixar_titulo(p_id uuid, p_conta uuid, p_data date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual public.financeiro_titulos%rowtype;
  novo uuid;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011012);
  select * into atual from public.financeiro_titulos where id = p_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if atual.status = 'pago' then
    if atual.conta_id = p_conta and atual.pago_em = p_data then return atual.lancamento_id; end if;
    raise exception 'Esta conta já foi %.', case when atual.tipo = 'pagar' then 'paga' else 'recebida' end;
  end if;
  if atual.status = 'cancelado' then raise exception 'Esta conta foi cancelada.'; end if;
  if p_data is null or p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data de hoje ou anterior.'; end if;
  if p_conta is null or not exists (select 1 from public.financeiro_contas where id = p_conta and ativa) then
    raise exception 'Escolha uma conta financeira ativa.';
  end if;

  insert into public.financeiro_lancamentos (tipo, origem_id, destino_id, valor, descricao, categoria, data)
  values (
    case when atual.tipo = 'pagar' then 'saida' else 'entrada' end,
    case when atual.tipo = 'pagar' then p_conta end,
    case when atual.tipo = 'receber' then p_conta end,
    atual.valor,
    left(case when atual.tipo = 'pagar' then 'Pagamento: ' else 'Recebimento: ' end || atual.descricao
         || case when atual.pessoa <> '' then ' · ' || atual.pessoa else '' end
         || case when atual.parcelas > 1 then ' (' || atual.parcela || '/' || atual.parcelas || ')' else '' end, 300),
    coalesce(nullif(atual.categoria, ''), case when atual.tipo = 'pagar' then 'Contas a pagar' else 'Contas a receber' end),
    p_data
  ) returning id into novo;

  update public.financeiro_titulos
     set status = 'pago', conta_id = p_conta, pago_em = p_data, lancamento_id = novo, atualizado_em = now()
   where id = p_id;
  return novo;
end;
$$;

/** Desfaz o pagamento/recebimento: estorna o lançamento (fica no histórico) e reabre a conta. */
create function public.financeiro_desfazer_baixa(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual public.financeiro_titulos%rowtype;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011012);
  select * into atual from public.financeiro_titulos where id = p_id for update;
  if not found or atual.status <> 'pago' then raise exception 'Esta conta não está paga.'; end if;
  -- O gatilho abaixo reabre o título quando o estorno é lançado
  perform public.financeiro_estornar(atual.lancamento_id, p_motivo);
end;
$$;

/** Cancela uma conta em aberto (não mexe em dinheiro). */
create function public.financeiro_cancelar_titulo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011012);
  update public.financeiro_titulos set status = 'cancelado', atualizado_em = now() where id = p_id and status = 'aberto';
  if not found then raise exception 'Só dá para cancelar uma conta em aberto.'; end if;
end;
$$;

/** Estorno do lançamento de um pagamento (por aqui ou pelo Financeiro) reabre o título. */
create function privado.financeiro_titulo_estornado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estorno_de is not null then
    update public.financeiro_titulos
       set status = 'aberto', conta_id = null, pago_em = null, lancamento_id = null, atualizado_em = now()
     where lancamento_id = new.estorno_de and status = 'pago';
  end if;
  return new;
end;
$$;
create trigger financeiro_titulo_estornado after insert on public.financeiro_lancamentos
  for each row execute function privado.financeiro_titulo_estornado();

revoke all on function public.financeiro_salvar_titulo(uuid, text, text, text, text, text, text, bigint, date, integer) from public, anon;
revoke all on function public.financeiro_baixar_titulo(uuid, uuid, date) from public, anon;
revoke all on function public.financeiro_desfazer_baixa(uuid, text) from public, anon;
revoke all on function public.financeiro_cancelar_titulo(uuid) from public, anon;
revoke all on function privado.financeiro_titulo_estornado() from public, anon, authenticated;
grant execute on function public.financeiro_salvar_titulo(uuid, text, text, text, text, text, text, bigint, date, integer) to authenticated;
grant execute on function public.financeiro_baixar_titulo(uuid, uuid, date) to authenticated;
grant execute on function public.financeiro_desfazer_baixa(uuid, text) to authenticated;
grant execute on function public.financeiro_cancelar_titulo(uuid) to authenticated;

notify pgrst, 'reload schema';
