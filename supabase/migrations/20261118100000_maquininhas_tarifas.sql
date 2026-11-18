-- Maquininhas de cartão e taxa do Pix.
--
-- Cada maquininha tem a sua porcentagem (ex.: 10% → venda de R$ 100 deixa
-- R$ 90 para a loja). O Pix tem uma porcentagem única (Configurações).
--
-- Na hora em que o pedido é concluído, o banco grava no pedido a tarifa daquele
-- momento (pedidos.tarifa, em centavos, e a porcentagem em tarifa_bp). Mudar a
-- porcentagem depois não muda vendas antigas.
--   cartão → a maquininha escolhida no PDV; pedido do site → a maquininha padrão
--   pix    → a taxa do Pix
--   dinheiro → sem tarifa
-- O financeiro lança o valor LÍQUIDO (total − tarifa) na conta: é o que cai de fato.
-- Porcentagens em "pontos-base": 1% = 100, 2,99% = 299, 100% = 10000.

create table public.maquininhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 40),
  taxa_bp integer not null check (taxa_bp between 0 and 10000),
  padrao boolean not null default false,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index maquininhas_nome on public.maquininhas (lower(btrim(nome)));
create unique index maquininhas_uma_padrao on public.maquininhas (padrao) where padrao;
alter table public.maquininhas enable row level security;
revoke all on public.maquininhas from public, anon, authenticated;
grant select on public.maquininhas to authenticated;
create policy maquininhas_admin_le on public.maquininhas for select to authenticated using ((select public.is_admin()));

alter table public.financeiro_config
  add column if not exists taxa_pix_bp integer not null default 0 check (taxa_pix_bp between 0 and 10000);

alter table public.pedidos
  add column if not exists maquininha_id uuid references public.maquininhas (id) on delete set null,
  add column if not exists maquininha_nome text,
  add column if not exists tarifa_bp integer check (tarifa_bp between 0 and 10000),
  add column if not exists tarifa integer not null default 0 check (tarifa >= 0);

-- ---------------------------------------------------------------------
-- Cadastro (só admin)
-- ---------------------------------------------------------------------
create or replace function public.salvar_maquininha(p_id uuid, p_nome text, p_taxa_bp integer, p_padrao boolean, p_ativa boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_id is null or char_length(btrim(coalesce(p_nome, ''))) not between 1 and 40 then raise exception 'Informe o nome da maquininha (até 40 letras).'; end if;
  if p_taxa_bp is null or p_taxa_bp not between 0 and 10000 then raise exception 'A taxa deve ficar entre 0%% e 100%%.'; end if;
  if exists (select 1 from public.maquininhas where lower(btrim(nome)) = lower(btrim(p_nome)) and id <> p_id) then
    raise exception 'Já existe uma maquininha com esse nome.';
  end if;
  -- A padrão é a usada nos pedidos do site pagos no cartão; inativa não pode ser padrão
  if coalesce(p_padrao, false) and coalesce(p_ativa, true) then
    update public.maquininhas set padrao = false where padrao and id <> p_id;
  end if;
  insert into public.maquininhas (id, nome, taxa_bp, padrao, ativa)
  values (p_id, btrim(p_nome), p_taxa_bp, coalesce(p_padrao, false) and coalesce(p_ativa, true), coalesce(p_ativa, true))
  on conflict (id) do update
    set nome = excluded.nome, taxa_bp = excluded.taxa_bp, padrao = excluded.padrao, ativa = excluded.ativa;
  return p_id;
end;
$$;

/** Apaga a maquininha. As vendas antigas guardam o nome e a tarifa. */
create or replace function public.excluir_maquininha(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  delete from public.maquininhas where id = p_id;
  if not found then raise exception 'Maquininha não encontrada.'; end if;
end;
$$;

create or replace function public.salvar_taxa_pix(p_taxa_bp integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_taxa_bp is null or p_taxa_bp not between 0 and 10000 then raise exception 'A taxa deve ficar entre 0%% e 100%%.'; end if;
  update public.financeiro_config set taxa_pix_bp = p_taxa_bp where id = 1;
  if not found then insert into public.financeiro_config (id, taxa_pix_bp) values (1, p_taxa_bp); end if;
end;
$$;

/** Para o PDV (admin ou operador): maquininhas ativas e a taxa do Pix. */
create or replace function public.tarifas_pagamento()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_equipe();
  return jsonb_build_object(
    'pix_bp', coalesce((select taxa_pix_bp from public.financeiro_config where id = 1), 0),
    'maquininhas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'taxa_bp', taxa_bp, 'padrao', padrao)
                                              order by padrao desc, lower(nome))
                               from public.maquininhas where ativa), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.salvar_maquininha(uuid, text, integer, boolean, boolean) from public, anon;
revoke all on function public.excluir_maquininha(uuid) from public, anon;
revoke all on function public.salvar_taxa_pix(integer) from public, anon;
revoke all on function public.tarifas_pagamento() from public, anon;
grant execute on function public.salvar_maquininha(uuid, text, integer, boolean, boolean) to authenticated;
grant execute on function public.excluir_maquininha(uuid) to authenticated;
grant execute on function public.salvar_taxa_pix(integer) to authenticated;
grant execute on function public.tarifas_pagamento() to authenticated;

-- ---------------------------------------------------------------------
-- Tarifa gravada no pedido ao concluir
-- ---------------------------------------------------------------------
create or replace function privado.pedidos_tarifa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.maquininhas%rowtype;
  bp integer;
  mesma_forma boolean;
begin
  if new.status <> 'concluido' then return new; end if;
  mesma_forma := TG_OP = 'UPDATE' and old.status = 'concluido' and old.tarifa_bp is not null
                 and new.pagamento is not distinct from old.pagamento
                 and new.maquininha_id is not distinct from old.maquininha_id;
  if TG_OP = 'UPDATE' and mesma_forma and new.total is not distinct from old.total then return new; end if;

  if mesma_forma then
    bp := old.tarifa_bp;                       -- só o total mudou: mantém a porcentagem da venda
  elsif new.pagamento = 'cartao' then
    select * into m from public.maquininhas where id = new.maquininha_id;
    if not found then select * into m from public.maquininhas where padrao and ativa; end if;
    if m.id is not null then
      new.maquininha_id := m.id;
      new.maquininha_nome := m.nome;
      bp := m.taxa_bp;
    else
      new.maquininha_id := null;
      new.maquininha_nome := null;
      bp := 0;
    end if;
  elsif new.pagamento = 'pix' then
    new.maquininha_id := null;
    new.maquininha_nome := null;
    bp := coalesce((select taxa_pix_bp from public.financeiro_config where id = 1), 0);
  else
    new.maquininha_id := null;
    new.maquininha_nome := null;
    bp := 0;
  end if;

  new.tarifa_bp := bp;
  new.tarifa := least(round(new.total::numeric * bp / 10000), new.total)::integer;
  return new;
end;
$$;
revoke all on function privado.pedidos_tarifa() from public, anon, authenticated;
drop trigger if exists pedidos_tarifa on public.pedidos;
create trigger pedidos_tarifa before insert or update of status, total, pagamento, maquininha_id on public.pedidos
  for each row execute function privado.pedidos_tarifa();

-- ---------------------------------------------------------------------
-- Financeiro: a venda entra pelo valor líquido (total − tarifa)
-- ---------------------------------------------------------------------
create or replace function privado.financeiro_por_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare venda public.financeiro_vendas%rowtype; conta uuid; lancamento uuid; pedido uuid; numero bigint; liquido integer; detalhe text;
begin
  if TG_OP='UPDATE' and new.status is not distinct from old.status and new.total is not distinct from old.total
     and new.tarifa is not distinct from old.tarifa then return new;end if;
  if TG_OP<>'DELETE' and new.status<>'concluido' and not exists(select 1 from public.financeiro_vendas where pedido_id=new.id) then return new;end if;
  pedido:=case when TG_OP='DELETE' then old.id else new.id end;
  numero:=case when TG_OP='DELETE' then old.numero else new.numero end;
  liquido:=case when TG_OP='DELETE' then 0 else new.total-coalesce(new.tarifa,0) end;
  perform pg_advisory_xact_lock(11011012);
  select * into venda from public.financeiro_vendas where pedido_id=pedido;
  if TG_OP='UPDATE' and old.status='concluido' and new.status='concluido' and venda.pedido_id is null
    and old.criado_em<(select iniciado_em from public.financeiro_config where id=1) then return new;end if;
  if TG_OP<>'DELETE' and new.status='concluido' and venda.pedido_id is not null and venda.valor=liquido then return new;end if;
  if venda.pedido_id is not null then
    insert into public.financeiro_lancamentos(tipo,origem_id,valor,descricao,categoria,pedido_id,pedido_numero,estorno_de)
      values('estorno_venda',venda.conta_id,venda.valor,'Estorno da venda #'||numero,'Vendas',pedido,numero,venda.lancamento_id);
    delete from public.financeiro_vendas where pedido_id=pedido;
  end if;
  if TG_OP='DELETE' then return old;end if;
  if new.status='concluido' and liquido>0 then
    select id into conta from public.financeiro_contas where padrao and ativa;
    if conta is null then raise exception 'Configure uma conta padrão ativa para as vendas.';end if;
    -- Changing the total of a concluded sale retains its original destination.
    if venda.pedido_id is not null and old.status='concluido' then conta:=venda.conta_id;end if;
    detalhe:=case when coalesce(new.tarifa,0)>0 then
      ' (R$ '||replace(to_char(new.total/100.0,'FM999999990.00'),'.',',')||' − tarifa '
      ||coalesce(new.maquininha_nome, case when new.pagamento='pix' then 'Pix' else 'cartão' end)
      ||' R$ '||replace(to_char(new.tarifa/100.0,'FM999999990.00'),'.',',')||')' else '' end;
    insert into public.financeiro_lancamentos(tipo,destino_id,valor,descricao,categoria,pedido_id,pedido_numero)
      values('venda',conta,liquido,'Venda #'||numero||case when new.origem='balcao' then ' · PDV' else ' · Site' end||detalhe,'Vendas',pedido,numero) returning id into lancamento;
    insert into public.financeiro_vendas(pedido_id,conta_id,valor,lancamento_id) values(pedido,conta,liquido,lancamento);
  end if;
  return new;
end;$$;

drop trigger if exists pedidos_financeiro on public.pedidos;
create trigger pedidos_financeiro after insert or update of status, total, tarifa on public.pedidos
  for each row execute function privado.financeiro_por_pedido();

-- ---------------------------------------------------------------------
-- PDV: escolhe a maquininha na venda no cartão
-- ---------------------------------------------------------------------
drop function if exists public.registrar_venda_balcao(jsonb, text, integer, integer, text);
create function public.registrar_venda_balcao(
  p_itens jsonb, p_pagamento text, p_desconto integer default 0, p_valor_recebido integer default null,
  p_cliente_nome text default null, p_maquininha uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caixa uuid := privado.caixa_aberto();
  v_montado jsonb;
  v_itens jsonb;
  v_subtotal integer;
  v_desconto integer := greatest(coalesce(p_desconto, 0), 0);
  v_total integer;
  v_id uuid;
  v_numero bigint;
  v_tarifa integer;
  v_maquininha text;
begin
  perform privado.exigir_equipe();
  if v_caixa is null then
    raise exception 'Abra o caixa antes de vender.';
  end if;
  if p_pagamento not in ('pix', 'cartao', 'dinheiro') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if p_maquininha is not null and (p_pagamento <> 'cartao'
     or not exists (select 1 from public.maquininhas where id = p_maquininha and ativa)) then
    raise exception 'Escolha uma maquininha ativa para o cartão.';
  end if;

  v_montado := privado.montar_itens(p_itens);
  v_itens := v_montado -> 'itens';
  v_subtotal := (v_montado ->> 'subtotal')::integer;
  if v_desconto > v_subtotal then
    raise exception 'O desconto é maior que o valor da venda.';
  end if;
  v_total := v_subtotal - v_desconto;

  if p_pagamento = 'dinheiro' and p_valor_recebido is not null and p_valor_recebido < v_total then
    raise exception 'Valor recebido menor que o total.';
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, pagamento, valor_recebido, itens, subtotal, taxa, desconto, total,
    status, origem, caixa_id, atendente, maquininha_id
  ) values (
    coalesce(nullif(left(btrim(coalesce(p_cliente_nome, '')), 80), ''), 'Balcão'),
    '', 'balcao', p_pagamento,
    case when p_pagamento = 'dinheiro' then p_valor_recebido end,
    v_itens, v_subtotal, 0, v_desconto, v_total,
    'concluido', 'balcao', v_caixa, auth.uid(), p_maquininha
  )
  returning id, numero, tarifa, maquininha_nome into v_id, v_numero, v_tarifa, v_maquininha;

  perform privado.baixar_estoque(v_id, v_itens, 'venda_balcao', v_numero);

  return jsonb_build_object(
    'id', v_id,
    'numero', v_numero,
    'itens', v_itens,
    'subtotal', v_subtotal,
    'desconto', v_desconto,
    'total', v_total,
    'tarifa', v_tarifa,
    'maquininha', v_maquininha,
    'troco', case when p_pagamento = 'dinheiro' and p_valor_recebido is not null then p_valor_recebido - v_total else 0 end,
    'criado_em', now()
  );
end;
$function$;
revoke all on function public.registrar_venda_balcao(jsonb, text, integer, integer, text, uuid) from public, anon;
grant execute on function public.registrar_venda_balcao(jsonb, text, integer, integer, text, uuid) to authenticated;

notify pgrst, 'reload schema';
