-- Maquininha com taxa de débito e de crédito, e dois padrões:
--   padrao_pdv  → já vem escolhida no PDV
--   padrao_site → usada nos pedidos do site pagos no cartão (no site o cliente não
--                 diz se é débito ou crédito: vale a taxa de CRÉDITO)
-- A venda guarda débito/crédito em pedidos.cartao_tipo, e o nome gravado na venda
-- já diz qual foi ("Stone (débito)"), para o financeiro e o relatório.

alter table public.maquininhas rename column taxa_bp to taxa_credito_bp;
alter table public.maquininhas
  add column if not exists taxa_debito_bp integer not null default 0 check (taxa_debito_bp between 0 and 10000);
update public.maquininhas set taxa_debito_bp = taxa_credito_bp;
alter table public.maquininhas rename column padrao to padrao_site;
alter index public.maquininhas_uma_padrao rename to maquininhas_padrao_site;
alter table public.maquininhas add column if not exists padrao_pdv boolean not null default false;
create unique index if not exists maquininhas_padrao_pdv on public.maquininhas (padrao_pdv) where padrao_pdv;
update public.maquininhas set padrao_pdv = true where padrao_site and not exists (select 1 from public.maquininhas where padrao_pdv);

alter table public.pedidos
  add column if not exists cartao_tipo text check (cartao_tipo in ('debito', 'credito'));

-- ---------------------------------------------------------------------
-- Cadastro
-- ---------------------------------------------------------------------
drop function if exists public.salvar_maquininha(uuid, text, integer, boolean, boolean);
create function public.salvar_maquininha(
  p_id uuid, p_nome text, p_taxa_debito_bp integer, p_taxa_credito_bp integer,
  p_padrao_pdv boolean, p_padrao_site boolean, p_ativa boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ativa boolean := coalesce(p_ativa, true);
begin
  perform privado.exigir_admin();
  if p_id is null or char_length(btrim(coalesce(p_nome, ''))) not between 1 and 40 then raise exception 'Informe o nome da maquininha (até 40 letras).'; end if;
  if p_taxa_debito_bp is null or p_taxa_debito_bp not between 0 and 10000
     or p_taxa_credito_bp is null or p_taxa_credito_bp not between 0 and 10000 then
    raise exception 'As taxas devem ficar entre 0%% e 100%%.';
  end if;
  if exists (select 1 from public.maquininhas where lower(btrim(nome)) = lower(btrim(p_nome)) and id <> p_id) then
    raise exception 'Já existe uma maquininha com esse nome.';
  end if;
  -- Só uma padrão de cada; inativa não pode ser padrão
  if coalesce(p_padrao_pdv, false) and ativa then update public.maquininhas set padrao_pdv = false where padrao_pdv and id <> p_id; end if;
  if coalesce(p_padrao_site, false) and ativa then update public.maquininhas set padrao_site = false where padrao_site and id <> p_id; end if;
  insert into public.maquininhas (id, nome, taxa_debito_bp, taxa_credito_bp, padrao_pdv, padrao_site, ativa)
  values (p_id, btrim(p_nome), p_taxa_debito_bp, p_taxa_credito_bp,
          coalesce(p_padrao_pdv, false) and ativa, coalesce(p_padrao_site, false) and ativa, ativa)
  on conflict (id) do update
    set nome = excluded.nome, taxa_debito_bp = excluded.taxa_debito_bp, taxa_credito_bp = excluded.taxa_credito_bp,
        padrao_pdv = excluded.padrao_pdv, padrao_site = excluded.padrao_site, ativa = excluded.ativa;
  return p_id;
end;
$$;
revoke all on function public.salvar_maquininha(uuid, text, integer, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.salvar_maquininha(uuid, text, integer, integer, boolean, boolean, boolean) to authenticated;

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
    'maquininhas', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', id, 'nome', nome, 'taxa_debito_bp', taxa_debito_bp, 'taxa_credito_bp', taxa_credito_bp,
                                 'padrao_pdv', padrao_pdv, 'padrao_site', padrao_site)
                               order by padrao_pdv desc, lower(nome))
                               from public.maquininhas where ativa), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Tarifa gravada no pedido ao concluir (agora com débito/crédito)
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
                 and new.maquininha_id is not distinct from old.maquininha_id
                 and new.cartao_tipo is not distinct from old.cartao_tipo;
  if TG_OP = 'UPDATE' and mesma_forma and new.total is not distinct from old.total then return new; end if;

  if mesma_forma then
    bp := old.tarifa_bp;                       -- só o total mudou: mantém a porcentagem da venda
  elsif new.pagamento = 'cartao' then
    select * into m from public.maquininhas where id = new.maquininha_id;
    if not found then select * into m from public.maquininhas where padrao_site and ativa; end if;
    if m.id is not null then
      new.cartao_tipo := coalesce(new.cartao_tipo, 'credito');   -- site: cliente não informa → crédito
      new.maquininha_id := m.id;
      new.maquininha_nome := m.nome || case when new.cartao_tipo = 'debito' then ' (débito)' else ' (crédito)' end;
      bp := case when new.cartao_tipo = 'debito' then m.taxa_debito_bp else m.taxa_credito_bp end;
    else
      new.maquininha_id := null;
      new.maquininha_nome := null;
      bp := 0;
    end if;
  elsif new.pagamento = 'pix' then
    new.maquininha_id := null;
    new.maquininha_nome := null;
    new.cartao_tipo := null;
    bp := coalesce((select taxa_pix_bp from public.financeiro_config where id = 1), 0);
  else
    new.maquininha_id := null;
    new.maquininha_nome := null;
    new.cartao_tipo := null;
    bp := 0;
  end if;

  new.tarifa_bp := bp;
  new.tarifa := least(round(new.total::numeric * bp / 10000), new.total)::integer;
  return new;
end;
$$;
drop trigger if exists pedidos_tarifa on public.pedidos;
create trigger pedidos_tarifa before insert or update of status, total, pagamento, maquininha_id, cartao_tipo on public.pedidos
  for each row execute function privado.pedidos_tarifa();

-- ---------------------------------------------------------------------
-- PDV: maquininha (padrão do PDV se não vier) e débito/crédito
-- ---------------------------------------------------------------------
drop function if exists public.registrar_venda_balcao(jsonb, text, integer, integer, text, uuid);
create function public.registrar_venda_balcao(
  p_itens jsonb, p_pagamento text, p_desconto integer default 0, p_valor_recebido integer default null,
  p_cliente_nome text default null, p_maquininha uuid default null, p_cartao_tipo text default null
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
  v_maquininha_id uuid;
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
  if p_cartao_tipo is not null and (p_pagamento <> 'cartao' or p_cartao_tipo not in ('debito', 'credito')) then
    raise exception 'Escolha débito ou crédito.';
  end if;
  if p_pagamento = 'cartao' then
    v_maquininha_id := coalesce(p_maquininha, (select id from public.maquininhas where padrao_pdv and ativa));
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
    status, origem, caixa_id, atendente, maquininha_id, cartao_tipo
  ) values (
    coalesce(nullif(left(btrim(coalesce(p_cliente_nome, '')), 80), ''), 'Balcão'),
    '', 'balcao', p_pagamento,
    case when p_pagamento = 'dinheiro' then p_valor_recebido end,
    v_itens, v_subtotal, 0, v_desconto, v_total,
    'concluido', 'balcao', v_caixa, auth.uid(), v_maquininha_id,
    case when p_pagamento = 'cartao' then coalesce(p_cartao_tipo, 'credito') end
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
revoke all on function public.registrar_venda_balcao(jsonb, text, integer, integer, text, uuid, text) from public, anon;
grant execute on function public.registrar_venda_balcao(jsonb, text, integer, integer, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
