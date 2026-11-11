-- =====================================================================
-- Adega011 · Frete por distância, pedido v2 (adicionais + estoque),
-- PDV com caixa e relatório de vendas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuração do frete
-- modo_frete = 'regioes'   -> cliente escolhe a região (taxa fixa por região)
-- modo_frete = 'distancia' -> taxa_base + taxa_por_km × km rodados (Google Maps)
-- ---------------------------------------------------------------------
alter table public.configuracoes
  add column if not exists modo_frete text not null default 'regioes' check (modo_frete in ('regioes', 'distancia')),
  add column if not exists taxa_base integer not null default 200 check (taxa_base >= 0),
  add column if not exists taxa_por_km integer not null default 150 check (taxa_por_km >= 0),
  add column if not exists raio_maximo_km numeric(5, 1) not null default 15 check (raio_maximo_km > 0),
  add column if not exists cidade_padrao text not null default '',
  -- origem geocodificada (preenchida pela função de cotação; não editar à mão)
  add column if not exists loja_lat double precision,
  add column if not exists loja_lng double precision,
  add column if not exists loja_endereco_geocodificado text;

-- O público lê a configuração; as coordenadas internas também (não são segredo).

-- Cotações calculadas pela Edge Function "cotar-frete" (com a chave secreta).
-- Ninguém pela API grava aqui; o pedido só aceita taxa de uma cotação válida.
create table if not exists public.cotacoes_frete (
  id uuid primary key default gen_random_uuid(),
  endereco text not null,            -- endereço informado, normalizado
  endereco_formatado text not null,  -- como o Google entendeu
  km numeric(6, 1) not null,
  taxa integer not null,
  ip text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '45 minutes'
);
create index if not exists cotacoes_frete_ip_idx on public.cotacoes_frete (ip, criado_em desc);
alter table public.cotacoes_frete enable row level security;
revoke all on public.cotacoes_frete from anon, authenticated;

create or replace function privado.normalizar_endereco(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- Itens do pedido: valida produtos, adicionais (mín./máx.), estoque e preços.
-- p_itens: [{"produto_id": "...", "quantidade": 2, "opcoes": ["uuid", ...]}]
-- Devolve {itens: [...snapshot...], subtotal}
-- ---------------------------------------------------------------------
create or replace function privado.montar_itens(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_prod public.produtos%rowtype;
  v_grupo public.grupos_opcoes%rowtype;
  v_qtd integer;
  v_ops jsonb;
  v_n integer;
  v_validas integer;
  v_extra integer;
  v_snap jsonb;
  v_unit integer;
  v_itens jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_total_produto jsonb := '{}'::jsonb;
  v_ja integer;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 60 then
    raise exception 'Seu carrinho está vazio.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'quantidade')::integer;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida no carrinho.';
    end if;

    select * into v_prod from public.produtos pr
      where pr.id = (v_item ->> 'produto_id')::uuid and pr.ativo
      for update;
    if not found then
      raise exception 'Um dos produtos do carrinho não está mais disponível.';
    end if;
    if not v_prod.disponivel then
      raise exception '% está esgotado.', v_prod.nome;
    end if;

    -- Estoque (somando o mesmo produto em linhas com adicionais diferentes)
    v_ja := coalesce((v_total_produto ->> v_prod.id::text)::integer, 0) + v_qtd;
    v_total_produto := v_total_produto || jsonb_build_object(v_prod.id::text, v_ja);
    if v_prod.controla_estoque and v_ja > v_prod.estoque then
      if v_prod.estoque <= 0 then
        raise exception '% está esgotado.', v_prod.nome;
      end if;
      raise exception '% · só temos % em estoque.', v_prod.nome, v_prod.estoque;
    end if;

    -- Adicionais
    v_ops := coalesce(v_item -> 'opcoes', '[]'::jsonb);
    if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) > 40 then
      raise exception 'Adicionais inválidos.';
    end if;
    if (select count(distinct e) from jsonb_array_elements_text(v_ops) e) <> jsonb_array_length(v_ops) then
      raise exception 'Adicional repetido no pedido.';
    end if;

    select count(*), coalesce(sum(o.preco), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'grupo', g.nome, 'nome', o.nome, 'preco', o.preco)
                     order by g.ordem, o.ordem), '[]'::jsonb)
      into v_validas, v_extra, v_snap
      from jsonb_array_elements_text(v_ops) e
      join public.opcoes o on o.id = e::uuid
      join public.grupos_opcoes g on g.id = o.grupo_id
     where g.produto_id = v_prod.id and o.disponivel;
    if v_validas <> jsonb_array_length(v_ops) then
      raise exception 'Um adicional de % não está mais disponível.', v_prod.nome;
    end if;

    for v_grupo in select * from public.grupos_opcoes g where g.produto_id = v_prod.id loop
      select count(*) into v_n
        from jsonb_array_elements_text(v_ops) e join public.opcoes o on o.id = e::uuid
       where o.grupo_id = v_grupo.id;
      if v_n < v_grupo.minimo then
        raise exception 'Escolha % em "%" (%).', v_grupo.minimo, v_grupo.nome, v_prod.nome;
      end if;
      if v_n > v_grupo.maximo then
        raise exception 'Escolha no máximo % em "%" (%).', v_grupo.maximo, v_grupo.nome, v_prod.nome;
      end if;
    end loop;

    v_unit := v_prod.preco + v_extra;
    v_subtotal := v_subtotal + v_unit * v_qtd;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'produto_id', v_prod.id,
      'nome', v_prod.nome,
      'preco', v_unit,
      'preco_base', v_prod.preco,
      'quantidade', v_qtd,
      'opcoes', v_snap
    ));
  end loop;

  return jsonb_build_object('itens', v_itens, 'subtotal', v_subtotal);
end;
$$;

-- Baixa o estoque de todos os itens de um pedido já inserido.
create or replace function privado.baixar_estoque(p_pedido uuid, p_itens jsonb, p_motivo text, p_numero bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_itens) loop
    perform privado.movimentar_estoque((v_item ->> 'produto_id')::uuid, -((v_item ->> 'quantidade')::integer),
      p_motivo, p_pedido, 'Pedido #' || p_numero, false);
  end loop;
  update public.pedidos set estoque_baixado = true where id = p_pedido;
end;
$$;

-- ---------------------------------------------------------------------
-- criar_pedido v2 (compatível com a versão anterior: p_cotacao_id é opcional)
-- ---------------------------------------------------------------------
drop function if exists public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb);

create or replace function public.criar_pedido(
  p_cliente_nome text,
  p_cliente_telefone text,
  p_tipo text,
  p_regiao_id uuid,
  p_endereco text,
  p_pagamento text,
  p_troco_para integer,
  p_observacoes text,
  p_itens jsonb,
  p_cotacao_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.configuracoes%rowtype;
  v_regiao public.regioes_entrega%rowtype;
  v_cot public.cotacoes_frete%rowtype;
  v_montado jsonb;
  v_itens jsonb;
  v_subtotal integer;
  v_taxa integer := 0;
  v_regiao_nome text;
  v_km numeric(6, 1);
  v_telefone text := regexp_replace(coalesce(p_cliente_telefone, ''), '\D', '', 'g');
  v_recentes integer;
  v_id uuid;
  v_numero bigint;
begin
  select * into v_cfg from public.configuracoes c where c.id = 1;

  if v_cfg.status_manual = 'fechada' then
    raise exception 'A loja está fechada no momento.';
  end if;
  if coalesce(btrim(p_cliente_nome), '') = '' or char_length(p_cliente_nome) > 80 then
    raise exception 'Informe seu nome.';
  end if;
  if char_length(v_telefone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.';
  end if;

  select count(*) into v_recentes from public.pedidos pe
    where pe.cliente_telefone = v_telefone and pe.criado_em > now() - interval '10 minutes';
  if v_recentes >= 5 then
    raise exception 'Muitos pedidos em sequência. Aguarde alguns minutos ou chame no WhatsApp.';
  end if;

  if p_tipo not in ('entrega', 'retirada') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  if p_tipo = 'entrega' and not v_cfg.aceita_entrega then
    raise exception 'No momento não estamos fazendo entregas.';
  end if;
  if p_tipo = 'retirada' and not v_cfg.aceita_retirada then
    raise exception 'No momento não estamos aceitando retirada na loja.';
  end if;
  if p_pagamento is null or not (p_pagamento = any (v_cfg.pagamentos)) then
    raise exception 'Forma de pagamento indisponível.';
  end if;

  v_montado := privado.montar_itens(p_itens);
  v_itens := v_montado -> 'itens';
  v_subtotal := (v_montado ->> 'subtotal')::integer;

  if v_subtotal < v_cfg.pedido_minimo then
    raise exception 'O pedido mínimo é de R$ %.', replace(to_char(v_cfg.pedido_minimo / 100.0, 'FM999990.00'), '.', ',');
  end if;

  if p_tipo = 'entrega' then
    if coalesce(btrim(p_endereco), '') = '' then
      raise exception 'Informe o endereço de entrega.';
    end if;
    if v_cfg.modo_frete = 'distancia' then
      select * into v_cot from public.cotacoes_frete c where c.id = p_cotacao_id;
      if not found then
        raise exception 'Calcule a taxa de entrega antes de enviar.';
      end if;
      if v_cot.expira_em < now() then
        raise exception 'A taxa de entrega expirou. Calcule de novo.';
      end if;
      if position(v_cot.endereco in privado.normalizar_endereco(p_endereco)) <> 1 then
        raise exception 'O endereço mudou depois do cálculo da taxa. Calcule de novo.';
      end if;
      if v_cot.km > v_cfg.raio_maximo_km then
        raise exception 'Endereço fora da nossa área de entrega.';
      end if;
      v_taxa := v_cot.taxa;
      v_km := v_cot.km;
      v_regiao_nome := replace(to_char(v_cot.km, 'FM9990.0'), '.', ',') || ' km';
    else
      select * into v_regiao from public.regioes_entrega r where r.id = p_regiao_id and r.ativa;
      if not found then
        raise exception 'Selecione uma região de entrega válida.';
      end if;
      v_taxa := v_regiao.taxa;
      v_regiao_nome := v_regiao.nome;
    end if;
  end if;

  if p_pagamento = 'dinheiro' and p_troco_para is not null and p_troco_para < v_subtotal + v_taxa then
    raise exception 'O valor para troco é menor que o total do pedido.';
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, regiao_nome, endereco, pagamento,
    troco_para, observacoes, itens, subtotal, taxa, total, distancia_km, origem
  ) values (
    btrim(p_cliente_nome),
    v_telefone,
    p_tipo,
    v_regiao_nome,
    case when p_tipo = 'entrega' then left(btrim(p_endereco), 300) end,
    p_pagamento,
    case when p_pagamento = 'dinheiro' then p_troco_para end,
    nullif(left(btrim(coalesce(p_observacoes, '')), 500), ''),
    v_itens,
    v_subtotal,
    v_taxa,
    v_subtotal + v_taxa,
    v_km,
    'site'
  )
  returning id, numero into v_id, v_numero;

  perform privado.baixar_estoque(v_id, v_itens, 'pedido', v_numero);

  return jsonb_build_object(
    'id', v_id,
    'numero', v_numero,
    'subtotal', v_subtotal,
    'taxa', v_taxa,
    'total', v_subtotal + v_taxa,
    'itens', v_itens
  );
end;
$$;

revoke all on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb, uuid) from public;
grant execute on function public.criar_pedido(text, text, text, uuid, text, text, integer, text, jsonb, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Caixa e PDV (venda no balcão)
-- ---------------------------------------------------------------------
create table if not exists public.caixas (
  id uuid primary key default gen_random_uuid(),
  aberto_em timestamptz not null default now(),
  aberto_por uuid references auth.users (id) on delete set null default auth.uid(),
  valor_inicial integer not null default 0 check (valor_inicial >= 0),
  fechado_em timestamptz,
  fechado_por uuid references auth.users (id) on delete set null,
  valor_contado integer check (valor_contado is null or valor_contado >= 0),
  resumo jsonb,
  observacoes text
);
-- Só um caixa aberto por vez
create unique index if not exists caixas_um_aberto on public.caixas ((true)) where fechado_em is null;

create table if not exists public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.caixas (id) on delete cascade,
  tipo text not null check (tipo in ('sangria', 'suprimento')),
  valor integer not null check (valor > 0),
  descricao text,
  criado_por uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);

alter table public.pedidos drop constraint if exists pedidos_caixa_fk;
alter table public.pedidos add constraint pedidos_caixa_fk foreign key (caixa_id) references public.caixas (id) on delete set null;

alter table public.caixas enable row level security;
alter table public.caixa_movimentos enable row level security;
drop policy if exists "caixas_admin_le" on public.caixas;
create policy "caixas_admin_le" on public.caixas for select to authenticated using (public.is_admin());
drop policy if exists "caixa_movimentos_admin_le" on public.caixa_movimentos;
create policy "caixa_movimentos_admin_le" on public.caixa_movimentos for select to authenticated using (public.is_admin());
revoke all on public.caixas, public.caixa_movimentos from anon, authenticated;
grant select on public.caixas, public.caixa_movimentos to authenticated;

create or replace function privado.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Sem permissão.';
  end if;
end;
$$;

create or replace function privado.caixa_aberto()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.caixas where fechado_em is null limit 1;
$$;

-- Pedido do site marcado como concluído entra no caixa aberto (ex.: dinheiro do motoboy).
create or replace function privado.pedido_no_caixa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'concluido' and old.status <> 'concluido' and new.caixa_id is null then
    new.caixa_id := privado.caixa_aberto();
  end if;
  return new;
end;
$$;
drop trigger if exists pedidos_no_caixa on public.pedidos;
create trigger pedidos_no_caixa before update of status on public.pedidos
  for each row execute function privado.pedido_no_caixa();

create or replace function public.abrir_caixa(p_valor_inicial integer default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform privado.exigir_admin();
  if privado.caixa_aberto() is not null then
    raise exception 'Já existe um caixa aberto.';
  end if;
  insert into public.caixas (valor_inicial) values (greatest(coalesce(p_valor_inicial, 0), 0)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.movimentar_caixa(p_tipo text, p_valor integer, p_descricao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caixa uuid := privado.caixa_aberto();
begin
  perform privado.exigir_admin();
  if v_caixa is null then
    raise exception 'Abra o caixa primeiro.';
  end if;
  if p_tipo not in ('sangria', 'suprimento') or p_valor is null or p_valor <= 0 then
    raise exception 'Movimento inválido.';
  end if;
  insert into public.caixa_movimentos (caixa_id, tipo, valor, descricao)
    values (v_caixa, p_tipo, p_valor, nullif(left(btrim(coalesce(p_descricao, '')), 120), ''));
end;
$$;

-- Resumo de um caixa (o aberto, se não informar)
create or replace function public.resumo_caixa(p_caixa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caixa public.caixas%rowtype;
  v_vendas jsonb;
  v_dinheiro integer;
  v_supr integer;
  v_sang integer;
begin
  perform privado.exigir_admin();
  select * into v_caixa from public.caixas where id = coalesce(p_caixa, privado.caixa_aberto());
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('pagamento', pagamento, 'origem', origem, 'quantidade', qtd, 'total', total)), '[]'::jsonb),
         coalesce(sum(total) filter (where pagamento = 'dinheiro'), 0)
    into v_vendas, v_dinheiro
    from (
      select pagamento, origem, count(*) as qtd, sum(total) as total
        from public.pedidos
       where caixa_id = v_caixa.id and status <> 'cancelado'
       group by pagamento, origem
    ) t;

  select coalesce(sum(valor) filter (where tipo = 'suprimento'), 0),
         coalesce(sum(valor) filter (where tipo = 'sangria'), 0)
    into v_supr, v_sang
    from public.caixa_movimentos where caixa_id = v_caixa.id;

  return jsonb_build_object(
    'id', v_caixa.id,
    'aberto_em', v_caixa.aberto_em,
    'fechado_em', v_caixa.fechado_em,
    'valor_inicial', v_caixa.valor_inicial,
    'vendas', v_vendas,
    'total_vendas', (select coalesce(sum((x ->> 'total')::integer), 0) from jsonb_array_elements(v_vendas) x),
    'quantidade_vendas', (select coalesce(sum((x ->> 'quantidade')::integer), 0) from jsonb_array_elements(v_vendas) x),
    'suprimentos', v_supr,
    'sangrias', v_sang,
    'dinheiro_esperado', v_caixa.valor_inicial + v_dinheiro + v_supr - v_sang,
    'valor_contado', v_caixa.valor_contado,
    'movimentos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'valor', valor, 'descricao', descricao, 'criado_em', criado_em) order by criado_em), '[]'::jsonb)
                     from public.caixa_movimentos where caixa_id = v_caixa.id)
  );
end;
$$;

create or replace function public.fechar_caixa(p_valor_contado integer, p_observacoes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caixa uuid := privado.caixa_aberto();
  v_resumo jsonb;
begin
  perform privado.exigir_admin();
  if v_caixa is null then
    raise exception 'Não há caixa aberto.';
  end if;
  if p_valor_contado is null or p_valor_contado < 0 then
    raise exception 'Informe o dinheiro contado na gaveta.';
  end if;
  v_resumo := public.resumo_caixa(v_caixa);
  v_resumo := v_resumo || jsonb_build_object(
    'valor_contado', p_valor_contado,
    'diferenca', p_valor_contado - (v_resumo ->> 'dinheiro_esperado')::integer
  );
  update public.caixas
     set fechado_em = now(), fechado_por = auth.uid(), valor_contado = p_valor_contado,
         resumo = v_resumo, observacoes = nullif(left(btrim(coalesce(p_observacoes, '')), 300), '')
   where id = v_caixa;
  return v_resumo || jsonb_build_object('fechado_em', now());
end;
$$;

-- Venda no balcão
create or replace function public.registrar_venda_balcao(
  p_itens jsonb,
  p_pagamento text,
  p_desconto integer default 0,
  p_valor_recebido integer default null,
  p_cliente_nome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caixa uuid := privado.caixa_aberto();
  v_montado jsonb;
  v_itens jsonb;
  v_subtotal integer;
  v_desconto integer := greatest(coalesce(p_desconto, 0), 0);
  v_total integer;
  v_id uuid;
  v_numero bigint;
begin
  perform privado.exigir_admin();
  if v_caixa is null then
    raise exception 'Abra o caixa antes de vender.';
  end if;
  if p_pagamento not in ('pix', 'cartao', 'dinheiro') then
    raise exception 'Forma de pagamento inválida.';
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
    status, origem, caixa_id, atendente
  ) values (
    coalesce(nullif(left(btrim(coalesce(p_cliente_nome, '')), 80), ''), 'Balcão'),
    '', 'balcao', p_pagamento,
    case when p_pagamento = 'dinheiro' then p_valor_recebido end,
    v_itens, v_subtotal, 0, v_desconto, v_total,
    'concluido', 'balcao', v_caixa, auth.uid()
  )
  returning id, numero into v_id, v_numero;

  perform privado.baixar_estoque(v_id, v_itens, 'venda_balcao', v_numero);

  return jsonb_build_object(
    'id', v_id,
    'numero', v_numero,
    'itens', v_itens,
    'subtotal', v_subtotal,
    'desconto', v_desconto,
    'total', v_total,
    'troco', case when p_pagamento = 'dinheiro' and p_valor_recebido is not null then p_valor_recebido - v_total else 0 end,
    'criado_em', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Relatório de vendas (site + balcão), datas no horário de São Paulo
-- ---------------------------------------------------------------------
create or replace function public.relatorio_vendas(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de timestamptz := (p_inicio::timestamp at time zone 'America/Sao_Paulo');
  v_ate timestamptz := ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform privado.exigir_admin();
  if p_fim < p_inicio or p_fim - p_inicio > 366 then
    raise exception 'Período inválido.';
  end if;

  return (
    with base as (
      select * from public.pedidos
       where criado_em >= v_de and criado_em < v_ate and status <> 'cancelado'
    ),
    itens as (
      select i ->> 'nome' as nome, (i ->> 'quantidade')::integer as qtd,
             (i ->> 'preco')::integer * (i ->> 'quantidade')::integer as total
        from base, jsonb_array_elements(base.itens) i
    )
    select jsonb_build_object(
      'faturamento', coalesce((select sum(total) from base), 0),
      'pedidos', (select count(*) from base),
      'ticket_medio', coalesce((select round(avg(total)) from base), 0),
      'descontos', coalesce((select sum(desconto) from base), 0),
      'taxas_entrega', coalesce((select sum(taxa) from base), 0),
      'cancelados', (select count(*) from public.pedidos
                      where criado_em >= v_de and criado_em < v_ate and status = 'cancelado'),
      'por_origem', coalesce((select jsonb_agg(jsonb_build_object('chave', origem, 'pedidos', n, 'total', t) order by t desc)
                               from (select origem, count(*) n, sum(total) t from base group by origem) x), '[]'::jsonb),
      'por_pagamento', coalesce((select jsonb_agg(jsonb_build_object('chave', pagamento, 'pedidos', n, 'total', t) order by t desc)
                                  from (select pagamento, count(*) n, sum(total) t from base group by pagamento) x), '[]'::jsonb),
      'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'pedidos', n, 'total', t) order by dia)
                            from (select (criado_em at time zone 'America/Sao_Paulo')::date dia, count(*) n, sum(total) t
                                    from base group by 1) x), '[]'::jsonb),
      'top_produtos', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', q, 'total', t) order by q desc, t desc)
                                 from (select nome, sum(qtd) q, sum(total) t from itens group by nome order by q desc, t desc limit 10) x), '[]'::jsonb)
    )
  );
end;
$$;

-- Permissões das funções
revoke all on function privado.normalizar_endereco(text) from public, anon, authenticated;
revoke all on function privado.montar_itens(jsonb) from public, anon, authenticated;
revoke all on function privado.baixar_estoque(uuid, jsonb, text, bigint) from public, anon, authenticated;
revoke all on function privado.exigir_admin() from public, anon, authenticated;
revoke all on function privado.caixa_aberto() from public, anon, authenticated;

revoke all on function public.abrir_caixa(integer) from public, anon;
revoke all on function public.movimentar_caixa(text, integer, text) from public, anon;
revoke all on function public.resumo_caixa(uuid) from public, anon;
revoke all on function public.fechar_caixa(integer, text) from public, anon;
revoke all on function public.registrar_venda_balcao(jsonb, text, integer, integer, text) from public, anon;
revoke all on function public.relatorio_vendas(date, date) from public, anon;
grant execute on function public.abrir_caixa(integer) to authenticated;
grant execute on function public.movimentar_caixa(text, integer, text) to authenticated;
grant execute on function public.resumo_caixa(uuid) to authenticated;
grant execute on function public.fechar_caixa(integer, text) to authenticated;
grant execute on function public.registrar_venda_balcao(jsonb, text, integer, integer, text) to authenticated;
grant execute on function public.relatorio_vendas(date, date) to authenticated;
