-- Pix automático pelo Mercado Pago.
--
-- Fluxo: o site grava o pedido (criar_pedido) e chama a Edge Function "pix",
-- que cria a cobrança no Mercado Pago com o TOTAL DO BANCO (o navegador nunca
-- define o valor) e guarda aqui o QR Code. O pedido só vira "pago" quando a
-- função (rota /pix/webhook ou /pix/verificar) consulta o pagamento no próprio
-- Mercado Pago e o banco confere referência, valor e moeda (public.pix_aplicar).
-- Um aviso falso ou um print de comprovante não marcam nada como pago.
--
-- Pix vencido: o Mercado Pago avisa (cancelled/expired) e o pedido é cancelado,
-- devolvendo o estoque. Se o aviso não vier, a conciliação agendada consulta o
-- Mercado Pago (veja o README).

alter table public.configuracoes
  add column if not exists pix_online boolean not null default false;

-- Situação do Pix online no pedido (null = não é Pix online). Fica no pedido
-- para o painel ver na hora (Realtime de pedidos).
alter table public.pedidos
  add column if not exists pagamento_status text
    check (pagamento_status in ('pendente', 'pago', 'expirado', 'estornado'));

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  provedor text not null default 'mercadopago',
  id_externo text not null unique,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'expirado', 'estornado', 'divergente')),
  valor integer not null check (valor > 0),
  qr_code text,
  qr_code_base64 text,
  expira_em timestamptz not null,
  pago_em timestamptz,
  status_provedor text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pagamentos_pedido_idx on public.pagamentos(pedido_id);
-- No máximo uma cobrança em aberto (ou paga) por pedido
create unique index if not exists pagamentos_um_ativo_por_pedido
  on public.pagamentos(pedido_id) where status in ('pendente', 'pago');

alter table public.pagamentos enable row level security;
revoke all on public.pagamentos from public, anon, authenticated;
grant select on public.pagamentos to authenticated;
drop policy if exists pagamentos_admin on public.pagamentos;
create policy pagamentos_admin on public.pagamentos for select to authenticated using ((select public.is_admin()));
-- As Edge Functions não escrevem nas tabelas direto: usam as funções abaixo
-- (pix_preparar, pix_registrar, pix_aplicar, pix_vencidos), que guardam as regras.
-- Leitura: a função "pix" procura o Pix em aberto de um pedido.
grant select on public.pagamentos to service_role;

/**
 * Antes de criar a cobrança: confere se o pedido pode ser pago por Pix online
 * e devolve o total DO BANCO. Se já existe cobrança em aberto (ou paga), devolve ela.
 */
create or replace function public.pix_preparar(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_pag public.pagamentos%rowtype;
begin
  if not coalesce((select pix_online from public.configuracoes where id = 1), false) then
    raise exception 'Pix automático desligado.';
  end if;
  select * into v_pedido from public.pedidos where id = p_pedido;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.pagamento <> 'pix' or v_pedido.origem <> 'site' then raise exception 'Este pedido não é pago por Pix.'; end if;

  -- Uma cobrança por pedido: devolve a que existe; se venceu, o cliente faz outro pedido
  select * into v_pag from public.pagamentos where pedido_id = p_pedido order by criado_em desc limit 1;
  if found then
    if v_pag.status = 'pago' or (v_pag.status = 'pendente' and v_pag.expira_em > now() + interval '2 minutes') then
      return jsonb_build_object('existente', jsonb_build_object('id_externo', v_pag.id_externo, 'status', v_pag.status));
    end if;
    raise exception 'O Pix deste pedido venceu. Faça o pedido de novo.';
  end if;

  if v_pedido.status <> 'novo' then raise exception 'Este pedido não está mais aguardando pagamento.'; end if;
  if v_pedido.criado_em < now() - interval '2 hours' then raise exception 'Pedido antigo. Faça um novo pedido.'; end if;
  if v_pedido.total <= 0 then raise exception 'Pedido sem valor.'; end if;
  return jsonb_build_object('pedido', jsonb_build_object('numero', v_pedido.numero, 'total', v_pedido.total, 'cliente_nome', v_pedido.cliente_nome));
end;
$$;
revoke all on function public.pix_preparar(uuid) from public, anon, authenticated;
grant execute on function public.pix_preparar(uuid) to service_role;

/** Guarda a cobrança criada no Mercado Pago (valor tem de ser o total do pedido). */
create or replace function public.pix_registrar(
  p_pedido uuid, p_id_externo text, p_valor integer, p_qr_code text, p_qr_code_base64 text, p_expira_em timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_valor is distinct from (select total from public.pedidos where id = p_pedido) then
    raise exception 'Valor da cobrança diferente do pedido.';
  end if;
  insert into public.pagamentos (pedido_id, id_externo, valor, qr_code, qr_code_base64, expira_em)
  values (p_pedido, p_id_externo, p_valor, p_qr_code, p_qr_code_base64, p_expira_em)
  on conflict (id_externo) do nothing;
  update public.pedidos set pagamento_status = 'pendente' where id = p_pedido and pagamento_status is null;
end;
$$;
revoke all on function public.pix_registrar(uuid, text, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.pix_registrar(uuid, text, integer, text, text, timestamptz) to service_role;

/**
 * Status do Pix para a tela do cliente. Quem tem o id do pedido (uuid
 * impossível de adivinhar, devolvido só para quem fez o pedido) vê o QR Code
 * e se já foi pago. Nada de dados pessoais.
 */
create or replace function public.status_pix(p_pedido uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', pg.status,
    'valor', pg.valor,
    'expira_em', pg.expira_em,
    'qr_code', case when pg.status = 'pendente' then pg.qr_code end,
    'qr_code_base64', case when pg.status = 'pendente' then pg.qr_code_base64 end,
    'numero', pe.numero,
    -- Relógio do servidor: a contagem no celular não depende da hora do aparelho
    'agora', now()
  )
  from public.pagamentos pg
  join public.pedidos pe on pe.id = pg.pedido_id
  where pg.pedido_id = p_pedido
  order by pg.criado_em desc
  limit 1;
$$;
revoke all on function public.status_pix(uuid) from public;
grant execute on function public.status_pix(uuid) to anon, authenticated;

/**
 * Aplica o que o Mercado Pago informou (só a Edge Function chama, com a chave
 * de serviço). Confere referência, valor e moeda; repetir o mesmo aviso não
 * muda nada. Devolve o status final do pagamento.
 */
create or replace function public.pix_aplicar(
  p_id_externo text,
  p_referencia uuid,
  p_status_mp text,
  p_valor integer,
  p_moeda text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pag public.pagamentos%rowtype;
  v_novo text;
begin
  select * into v_pag from public.pagamentos where id_externo = p_id_externo for update;
  if not found then return 'desconhecido'; end if;

  if p_referencia is distinct from v_pag.pedido_id or p_valor is distinct from v_pag.valor or p_moeda is distinct from 'BRL' then
    -- Não bate com o que cobramos: não marca como pago, fica para conferência
    update public.pagamentos set status = 'divergente', status_provedor = p_status_mp, atualizado_em = now()
     where id = v_pag.id and status <> 'pago';
    return 'divergente';
  end if;

  v_novo := case
    when p_status_mp = 'approved' then 'pago'
    when p_status_mp in ('refunded', 'charged_back') then 'estornado'
    when p_status_mp in ('cancelled', 'rejected', 'expired') then 'expirado'
    else 'pendente'
  end;
  -- Pago só muda para estornado
  if v_pag.status = 'pago' and v_novo <> 'estornado' then return 'pago'; end if;
  if v_pag.status = v_novo then return v_novo; end if;

  update public.pagamentos
     set status = v_novo, status_provedor = p_status_mp, atualizado_em = now(),
         pago_em = case when v_novo = 'pago' then now() else pago_em end
   where id = v_pag.id;
  update public.pedidos set pagamento_status = v_novo where id = v_pag.pedido_id;

  -- Pix vencido sem pagamento: cancela o pedido ainda novo (devolve o estoque)
  if v_novo = 'expirado' then
    update public.pedidos set status = 'cancelado'
     where id = v_pag.pedido_id and status = 'novo';
  end if;
  return v_novo;
end;
$$;
revoke all on function public.pix_aplicar(text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.pix_aplicar(text, uuid, text, integer, text) to service_role;

/** Cobranças em aberto que já venceram (para a conciliação consultar o Mercado Pago). */
create or replace function public.pix_vencidos(p_limite integer default 20)
returns table (id_externo text, pedido_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select id_externo, pedido_id from public.pagamentos
   where status = 'pendente' and expira_em < now() - interval '5 minutes'
   order by expira_em limit least(greatest(p_limite, 1), 50);
$$;
revoke all on function public.pix_vencidos(integer) from public, anon, authenticated;
grant execute on function public.pix_vencidos(integer) to service_role;

notify pgrst, 'reload schema';
