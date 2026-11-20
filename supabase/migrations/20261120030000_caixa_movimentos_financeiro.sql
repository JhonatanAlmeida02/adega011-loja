-- Sangria e reforço (suprimento) do caixa do PDV também mexem no financeiro.
--
-- A gaveta é a conta "padrão do caixa" (ou, sem ela, a padrão para vendas):
--   sangria → SAÍDA dessa conta (pagou algo com o dinheiro da gaveta); ou
--             TRANSFERÊNCIA para a conta escolhida (ex.: depósito no banco)
--   reforço → TRANSFERÊNCIA da conta escolhida para a gaveta; ou ENTRADA, se
--             o dinheiro veio de fora (sem conta escolhida)
-- O lançamento fica ligado ao movimento (caixa_movimentos.lancamento_id).

alter table public.caixa_movimentos
  add column if not exists conta_id uuid references public.financeiro_contas (id),
  add column if not exists lancamento_id uuid references public.financeiro_lancamentos (id);

/** Conta da gaveta: a padrão do caixa ou, sem ela, a padrão para vendas. */
create or replace function privado.conta_da_gaveta()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.financeiro_contas where padrao_caixa and ativa),
    (select id from public.financeiro_contas where padrao and ativa)
  );
$$;
revoke all on function privado.conta_da_gaveta() from public, anon, authenticated;

/** Para o PDV (admin ou operador): a conta da gaveta e as outras (origem do reforço / destino da sangria). */
create or replace function public.contas_reforco_caixa()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare gaveta uuid := privado.conta_da_gaveta();
begin
  perform privado.exigir_equipe();
  return jsonb_build_object(
    'gaveta', (select jsonb_build_object('id', id, 'nome', nome) from public.financeiro_contas where id = gaveta),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo)
                                         order by (tipo = 'caixa') desc, lower(nome))
                          from public.financeiro_contas where ativa and id is distinct from gaveta), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.contas_reforco_caixa() from public, anon;
grant execute on function public.contas_reforco_caixa() to authenticated;

drop function if exists public.movimentar_caixa(text, integer, text);
create function public.movimentar_caixa(p_tipo text, p_valor integer, p_descricao text default null, p_conta uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caixa uuid := privado.caixa_aberto();
  v_gaveta uuid;
  v_movimento uuid;
  v_lancamento uuid;
  v_descricao text := nullif(left(btrim(coalesce(p_descricao, '')), 120), '');
  v_origem text;
begin
  perform privado.exigir_equipe();
  if v_caixa is null then
    raise exception 'Abra o caixa primeiro.';
  end if;
  if p_tipo not in ('sangria', 'suprimento') or p_valor is null or p_valor <= 0 then
    raise exception 'Movimento inválido.';
  end if;

  perform pg_advisory_xact_lock(11011012);
  v_gaveta := privado.conta_da_gaveta();
  if p_conta is not null then
    if not exists (select 1 from public.financeiro_contas where id = p_conta and ativa) then
      raise exception 'Escolha uma conta ativa.';
    end if;
    if p_conta = v_gaveta then
      raise exception 'Escolha outra conta (não a própria gaveta).';
    end if;
    select nome into v_origem from public.financeiro_contas where id = p_conta;
  end if;

  insert into public.caixa_movimentos (caixa_id, tipo, valor, descricao, conta_id)
    values (v_caixa, p_tipo, p_valor, v_descricao, p_conta)
    returning id into v_movimento;

  -- Sem conta no financeiro (nenhuma padrão ativa), o movimento fica só no caixa
  if v_gaveta is null then return; end if;

  if p_tipo = 'sangria' and p_conta is not null then
    insert into public.financeiro_lancamentos (tipo, origem_id, destino_id, valor, descricao, categoria)
      values ('transferencia', v_gaveta, p_conta, p_valor,
              left('Sangria do caixa (para ' || v_origem || ')' || coalesce(' · ' || v_descricao, ''), 300), 'Sangria do caixa')
      returning id into v_lancamento;
  elsif p_tipo = 'sangria' then
    insert into public.financeiro_lancamentos (tipo, origem_id, valor, descricao, categoria)
      values ('saida', v_gaveta, p_valor, left('Sangria do caixa' || coalesce(' · ' || v_descricao, ''), 300), 'Sangria do caixa')
      returning id into v_lancamento;
  elsif p_conta is not null then
    insert into public.financeiro_lancamentos (tipo, origem_id, destino_id, valor, descricao, categoria)
      values ('transferencia', p_conta, v_gaveta, p_valor,
              left('Reforço do caixa (de ' || v_origem || ')' || coalesce(' · ' || v_descricao, ''), 300), 'Reforço do caixa')
      returning id into v_lancamento;
  else
    insert into public.financeiro_lancamentos (tipo, destino_id, valor, descricao, categoria)
      values ('entrada', v_gaveta, p_valor, left('Reforço do caixa (dinheiro de fora)' || coalesce(' · ' || v_descricao, ''), 300), 'Reforço do caixa')
      returning id into v_lancamento;
  end if;
  update public.caixa_movimentos set lancamento_id = v_lancamento where id = v_movimento;
end;
$function$;
revoke all on function public.movimentar_caixa(text, integer, text, uuid) from public, anon;
grant execute on function public.movimentar_caixa(text, integer, text, uuid) to authenticated;

notify pgrst, 'reload schema';
