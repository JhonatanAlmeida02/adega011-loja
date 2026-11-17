-- =====================================================================
-- WMS · 03 · Núcleo transacional
-- Idempotência, auditoria, ocorrências, transições de estado, resolução de
-- códigos, lotes/séries e a função única de lançamento no ledger
-- (stock_entries + stock_balances na MESMA transação).
-- Códigos de erro (SQLSTATE) usados pela API:
--   WA401 sem autenticação · WA403 sem permissão · WA404 não encontrado
--   WA409 conflito de estado/versão/saldo · WA422 entrada inválida
-- =====================================================================

-- ---------------------------------------------------------------------
-- Transições de estado permitidas
-- ---------------------------------------------------------------------
delete from wms.state_transitions;
insert into wms.state_transitions (domain, from_state, to_state) values
  -- pedido (execução no armazém)
  ('order', 'awaiting_allocation', 'allocated'),
  ('order', 'awaiting_allocation', 'on_hold'),
  ('order', 'awaiting_allocation', 'cancelled'),
  ('order', 'allocated', 'picking'),
  ('order', 'allocated', 'on_hold'),
  ('order', 'allocated', 'cancelled'),
  ('order', 'picking', 'picked'),
  ('order', 'picking', 'on_hold'),
  ('order', 'picking', 'cancelled'),
  ('order', 'picked', 'checking'),
  ('order', 'picked', 'on_hold'),
  ('order', 'picked', 'cancelled'),
  ('order', 'checking', 'packed'),
  ('order', 'checking', 'on_hold'),
  ('order', 'checking', 'cancelled'),
  ('order', 'packed', 'ready_to_dispatch'),
  ('order', 'packed', 'on_hold'),
  ('order', 'packed', 'cancelled'),
  ('order', 'ready_to_dispatch', 'dispatched'),
  ('order', 'ready_to_dispatch', 'packed'),
  ('order', 'ready_to_dispatch', 'on_hold'),
  ('order', 'ready_to_dispatch', 'cancelled'),
  ('order', 'on_hold', 'awaiting_allocation'),
  ('order', 'on_hold', 'allocated'),
  ('order', 'on_hold', 'picking'),
  ('order', 'on_hold', 'picked'),
  ('order', 'on_hold', 'checking'),
  ('order', 'on_hold', 'packed'),
  ('order', 'on_hold', 'ready_to_dispatch'),
  ('order', 'on_hold', 'cancelled'),
  -- recebimento documental
  ('receipt', 'expected', 'receiving'),
  ('receipt', 'expected', 'cancelled'),
  ('receipt', 'receiving', 'awaiting_review'),
  ('receipt', 'receiving', 'partially_received'),
  ('receipt', 'receiving', 'received'),
  ('receipt', 'receiving', 'cancelled'),
  ('receipt', 'awaiting_review', 'receiving'),
  ('receipt', 'awaiting_review', 'partially_received'),
  ('receipt', 'awaiting_review', 'received'),
  ('receipt', 'partially_received', 'receiving'),
  ('receipt', 'partially_received', 'awaiting_review'),
  ('receipt', 'partially_received', 'received'),
  -- tarefa de separação
  ('picking_task', 'open', 'in_progress'),
  ('picking_task', 'open', 'completed'),
  ('picking_task', 'open', 'cancelled'),
  ('picking_task', 'open', 'invalidated'),
  ('picking_task', 'in_progress', 'completed'),
  ('picking_task', 'in_progress', 'cancelled'),
  ('picking_task', 'in_progress', 'invalidated'),
  -- inventário
  ('inventory', 'draft', 'counting'),
  ('inventory', 'draft', 'cancelled'),
  ('inventory', 'counting', 'review'),
  ('inventory', 'counting', 'cancelled'),
  ('inventory', 'review', 'closed'),
  ('inventory', 'review', 'cancelled'),
  -- remessa
  ('shipment', 'open', 'loading'),
  ('shipment', 'open', 'cancelled'),
  ('shipment', 'loading', 'dispatched'),
  ('shipment', 'loading', 'open'),
  ('shipment', 'loading', 'cancelled'),
  -- transferência entre armazéns
  ('transfer', 'draft', 'in_transit'),
  ('transfer', 'draft', 'cancelled'),
  ('transfer', 'in_transit', 'received'),
  ('transfer', 'in_transit', 'closed_with_discrepancy'),
  -- devolução
  ('return', 'expected', 'receiving'),
  ('return', 'expected', 'cancelled'),
  ('return', 'receiving', 'inspection'),
  ('return', 'receiving', 'closed'),
  ('return', 'inspection', 'closed');

create or replace function wms._assert_transition(p_domain text, p_from text, p_to text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_from = p_to then
    return;
  end if;
  if not exists (select 1 from wms.state_transitions t where t.domain = p_domain and t.from_state = p_from and t.to_state = p_to) then
    raise exception using errcode = 'WA409',
      message = format('Transição não permitida (%s): %s → %s.', p_domain, p_from, p_to), detail = 'invalid_transition';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Idempotência dos comandos
-- Mesma chave + mesmo conteúdo => devolve o resultado anterior (sem novo movimento).
-- Mesma chave + conteúdo diferente => conflito (WA409).
-- Retentativas concorrentes com a mesma chave esperam o índice único.
-- ---------------------------------------------------------------------
create or replace function wms._payload_hash(p_command text, p_payload jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(p_command || ':' || coalesce(p_payload::text, 'null'), 'UTF8')), 'hex');
$$;

create or replace function wms._idem_begin(p_org uuid, p_command text, p_key text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text := wms._payload_hash(p_command, p_payload);
  v_row wms.command_log;
  v_id uuid;
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then
    raise exception using errcode = 'WA422', message = 'Chave de idempotência ausente ou inválida (8 a 200 caracteres: letras, números, _ . : -).';
  end if;
  insert into wms.command_log (organization_id, idempotency_key, command, payload_hash, user_id)
  values (p_org, p_key, p_command, v_hash, auth.uid())
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    return null;
  end if;
  select * into v_row from wms.command_log where organization_id = p_org and idempotency_key = p_key;
  if v_row.command <> p_command or v_row.payload_hash <> v_hash or v_row.user_id is distinct from auth.uid() then
    raise exception using errcode = 'WA409', message = 'Chave de idempotência já usada com outro conteúdo.', detail = 'idempotency_conflict';
  end if;
  if v_row.result is null then
    raise exception using errcode = 'WA409', message = 'Comando com esta chave ainda está em processamento.', detail = 'idempotency_in_progress';
  end if;
  return v_row.result || jsonb_build_object('replayed', true);
end;
$$;

create or replace function wms._idem_finish(p_org uuid, p_key text, p_result jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update wms.command_log set result = coalesce(p_result, '{}'::jsonb)
   where organization_id = p_org and idempotency_key = p_key;
  return coalesce(p_result, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoria e ocorrências
-- ---------------------------------------------------------------------
create or replace function wms._audit(p_org uuid, p_wh uuid, p_action text, p_entity_type text, p_entity_id text, p_data jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into wms.audit_events (organization_id, warehouse_id, actor_id, action, entity_type, entity_id, data, correlation_id)
  values (p_org, p_wh, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb),
          nullif(current_setting('wms.correlation_id', true), ''));
$$;

create or replace function wms._discrepancy(
  p_org uuid, p_wh uuid, p_kind text, p_entity_type text, p_entity_id uuid,
  p_product uuid default null, p_location uuid default null, p_qty numeric default null, p_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into wms.discrepancies (organization_id, warehouse_id, kind, entity_type, entity_id, product_id, location_id, quantity, details, created_by)
  values (p_org, p_wh, p_kind, p_entity_type, p_entity_id, p_product, p_location, p_qty, coalesce(p_details, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Resolução de códigos (produto, unidade e fator). Sem escolha arbitrária:
-- mais de um produto para o mesmo código => conflito com os candidatos.
-- ---------------------------------------------------------------------
create or replace function wms.resolve_code(p_org uuid, p_code text)
returns table (product_id uuid, sku text, description text, unit_code text, factor numeric)
language sql stable security definer set search_path = ''
as $$
  select distinct p.id, p.sku, p.description, coalesce(u.code, p.base_unit), coalesce(u.factor, 1::numeric)
    from wms.product_barcodes b
    join wms.products p on p.id = b.product_id and p.status = 'active'
    left join wms.product_units u on u.id = b.unit_id
   where b.organization_id = p_org and b.barcode = p_code
     and p_org = any (wms.my_org_ids())
  union
  select p.id, p.sku, p.description, p.base_unit, 1::numeric
    from wms.products p
   where p.organization_id = p_org and p.status = 'active' and (p.gtin = p_code or p.sku = p_code)
     and p_org = any (wms.my_org_ids());
$$;

create or replace function wms._resolve_one(p_org uuid, p_code text, p_product uuid default null)
returns table (product_id uuid, unit_code text, factor numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_count integer;
  v_candidates jsonb;
begin
  if p_code is null or char_length(p_code) = 0 then
    raise exception using errcode = 'WA422', message = 'Código lido vazio.';
  end if;
  select count(*), jsonb_agg(jsonb_build_object('product_id', r.product_id, 'sku', r.sku, 'description', r.description, 'unit', r.unit_code, 'factor', r.factor))
    into v_count, v_candidates
    from wms.resolve_code(p_org, p_code) r
   where p_product is null or r.product_id = p_product;
  if v_count = 0 then
    raise exception using errcode = 'WA404', message = format('Código %s não corresponde a nenhum produto ativo.', p_code), detail = 'unknown_code';
  end if;
  if v_count > 1 then
    raise exception using errcode = 'WA409', message = 'Código ambíguo: escolha o produto.', detail = 'ambiguous_code', hint = v_candidates::text;
  end if;
  return query
    select r.product_id, r.unit_code, r.factor from wms.resolve_code(p_org, p_code) r
     where p_product is null or r.product_id = p_product;
end;
$$;

create or replace function wms._location_by_code(p_org uuid, p_wh uuid, p_code text)
returns wms.locations
language plpgsql stable security definer set search_path = ''
as $$
declare v wms.locations;
begin
  select * into v from wms.locations where organization_id = p_org and warehouse_id = p_wh and code = upper(trim(p_code));
  if not found then
    raise exception using errcode = 'WA404', message = format('Endereço %s não existe neste armazém.', p_code), detail = 'unknown_location';
  end if;
  return v;
end;
$$;

-- Lote: cria ou reutiliza; validade divergente do mesmo lote é conflito.
create or replace function wms._ensure_lot(p_org uuid, p_product uuid, p_code text, p_expiry date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_prod wms.products;
  v_lot wms.lots;
begin
  select * into v_prod from wms.products where id = p_product and organization_id = p_org;
  if not v_prod.lot_control then
    if p_code is not null then
      raise exception using errcode = 'WA422', message = format('Produto %s não controla lote.', v_prod.sku);
    end if;
    return null;
  end if;
  if p_code is null or char_length(trim(p_code)) = 0 then
    raise exception using errcode = 'WA422', message = format('Produto %s exige lote.', v_prod.sku), detail = 'lot_required';
  end if;
  if v_prod.expiry_control and p_expiry is null and not exists (select 1 from wms.lots where product_id = p_product and code = trim(p_code)) then
    raise exception using errcode = 'WA422', message = format('Produto %s exige validade do lote.', v_prod.sku), detail = 'expiry_required';
  end if;
  insert into wms.lots (organization_id, product_id, code, expiry_date)
  values (p_org, p_product, trim(p_code), p_expiry)
  on conflict (product_id, code) do nothing;
  select * into v_lot from wms.lots where product_id = p_product and code = trim(p_code);
  if p_expiry is not null and v_lot.expiry_date is distinct from p_expiry then
    raise exception using errcode = 'WA409', message = format('Lote %s já cadastrado com validade %s.', v_lot.code, coalesce(v_lot.expiry_date::text, 'sem validade')), detail = 'lot_expiry_conflict';
  end if;
  return v_lot.id;
end;
$$;

create or replace function wms._find_lot(p_product uuid, p_code text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  if p_code is null then
    return null;
  end if;
  select id into v from wms.lots where product_id = p_product and code = trim(p_code);
  if v is null then
    raise exception using errcode = 'WA404', message = format('Lote %s não encontrado para o produto.', p_code), detail = 'unknown_lot';
  end if;
  return v;
end;
$$;

create or replace function wms._ensure_serial(p_org uuid, p_product uuid, p_serial text, p_lot uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  if p_serial is null or char_length(trim(p_serial)) = 0 then
    raise exception using errcode = 'WA422', message = 'Produto exige número de série.', detail = 'serial_required';
  end if;
  insert into wms.serial_numbers (organization_id, product_id, serial, lot_id)
  values (p_org, p_product, trim(p_serial), p_lot)
  on conflict (product_id, serial) do nothing;
  select id into v from wms.serial_numbers where product_id = p_product and serial = trim(p_serial);
  return v;
end;
$$;

create or replace function wms._find_serial(p_product uuid, p_serial text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  if p_serial is null then
    return null;
  end if;
  select id into v from wms.serial_numbers where product_id = p_product and serial = trim(p_serial);
  if v is null then
    raise exception using errcode = 'WA404', message = format('Série %s não encontrada.', p_serial), detail = 'unknown_serial';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Ledger: cabeçalho e partidas
-- ---------------------------------------------------------------------
create or replace function wms._new_movement(
  p_org uuid, p_wh uuid, p_type text, p_reason text, p_ref_type text, p_ref_id uuid, p_key text,
  p_erp_posting text default 'none', p_reverses uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  insert into wms.stock_movements (organization_id, warehouse_id, movement_type, reason, reference_type, reference_id,
                                   idempotency_key, erp_posting, reverses_movement_id, created_by)
  values (p_org, p_wh, p_type, p_reason, p_ref_type, p_ref_id, p_key, p_erp_posting, p_reverses, auth.uid())
  returning id into v;
  return v;
end;
$$;

-- Única porta de alteração de saldo. Valida endereço (ativo, bloqueio, inventário,
-- capacidade), lote, série (uma posição por série) e não deixa saldo negativo
-- nem reserva maior que o físico (constraints da projeção).
create or replace function wms._post_entry(
  p_movement uuid, p_org uuid, p_wh uuid, p_loc uuid, p_product uuid, p_lot uuid, p_serial uuid,
  p_condition text, p_qty numeric, p_reserved_delta numeric default 0, p_allow_counting boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_loc wms.locations;
  v_prod wms.products;
  v_ser wms.serial_numbers;
  v_rows integer;
  v_total numeric;
begin
  if p_qty is null or p_qty = 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade da partida não pode ser zero.';
  end if;
  if p_qty > 0 then
    select * into v_loc from wms.locations where id = p_loc and organization_id = p_org and warehouse_id = p_wh for no key update;
  else
    select * into v_loc from wms.locations where id = p_loc and organization_id = p_org and warehouse_id = p_wh for share;
  end if;
  if not found then
    raise exception using errcode = 'WA422', message = 'Endereço não pertence ao armazém.', detail = 'location_scope';
  end if;
  if v_loc.status <> 'active' then
    raise exception using errcode = 'WA409', message = format('Endereço %s inativo.', v_loc.code), detail = 'location_inactive';
  end if;
  if v_loc.counting_session_id is not null and not p_allow_counting then
    raise exception using errcode = 'WA409', message = format('Endereço %s em inventário: movimentação bloqueada.', v_loc.code), detail = 'location_counting';
  end if;
  if p_qty > 0 and v_loc.blocked then
    raise exception using errcode = 'WA409', message = format('Endereço %s bloqueado: %s', v_loc.code, coalesce(v_loc.block_reason, 'sem motivo')), detail = 'location_blocked';
  end if;
  if p_qty > 0 and v_loc.capacity_units is not null then
    select coalesce(sum(quantity), 0) into v_total from wms.stock_balances where location_id = p_loc;
    if v_total + p_qty > v_loc.capacity_units then
      raise exception using errcode = 'WA409', message = format('Capacidade do endereço %s excedida (%s de %s).', v_loc.code, v_total + p_qty, v_loc.capacity_units), detail = 'location_capacity';
    end if;
  end if;

  select * into v_prod from wms.products where id = p_product and organization_id = p_org;
  if not found then
    raise exception using errcode = 'WA422', message = 'Produto inválido.';
  end if;
  if v_prod.lot_control and p_lot is null then
    raise exception using errcode = 'WA422', message = format('Produto %s exige lote.', v_prod.sku), detail = 'lot_required';
  end if;
  if not v_prod.lot_control and p_lot is not null then
    raise exception using errcode = 'WA422', message = format('Produto %s não controla lote.', v_prod.sku);
  end if;

  if v_prod.serial_control then
    if p_serial is null then
      raise exception using errcode = 'WA422', message = format('Produto %s exige número de série.', v_prod.sku), detail = 'serial_required';
    end if;
    if abs(p_qty) <> 1 then
      raise exception using errcode = 'WA422', message = 'Produto com série movimenta uma unidade inteira por série.', detail = 'serial_qty';
    end if;
    select * into v_ser from wms.serial_numbers where id = p_serial and product_id = p_product for update;
    if not found then
      raise exception using errcode = 'WA422', message = 'Série não pertence ao produto.';
    end if;
    if p_qty < 0 then
      if v_ser.location_id is distinct from p_loc or v_ser.condition is distinct from p_condition then
        raise exception using errcode = 'WA409', message = format('Série %s não está no endereço %s.', v_ser.serial, v_loc.code), detail = 'serial_location';
      end if;
      update wms.serial_numbers set location_id = null, condition = null, updated_at = now() where id = p_serial;
    else
      if v_ser.location_id is not null then
        raise exception using errcode = 'WA409', message = format('Série duplicada: %s já está em estoque.', v_ser.serial), detail = 'serial_duplicate';
      end if;
      if v_ser.lot_id is distinct from p_lot then
        raise exception using errcode = 'WA422', message = format('Série %s pertence a outro lote.', v_ser.serial);
      end if;
      update wms.serial_numbers set location_id = p_loc, condition = p_condition, status = 'in_stock', updated_at = now() where id = p_serial;
    end if;
  elsif p_serial is not null then
    raise exception using errcode = 'WA422', message = format('Produto %s não controla série.', v_prod.sku);
  end if;

  if p_qty < 0 then
    begin
      update wms.stock_balances
         set quantity = quantity + p_qty, reserved = reserved + coalesce(p_reserved_delta, 0), updated_at = now()
       where location_id = p_loc and product_id = p_product and lot_id is not distinct from p_lot and condition = p_condition;
      get diagnostics v_rows = row_count;
    exception when check_violation then
      raise exception using errcode = 'WA409', message = format('Saldo disponível insuficiente em %s.', v_loc.code), detail = 'insufficient_stock';
    end;
    if v_rows = 0 then
      raise exception using errcode = 'WA409', message = format('Sem saldo do produto em %s.', v_loc.code), detail = 'insufficient_stock';
    end if;
  else
    begin
      insert into wms.stock_balances (organization_id, warehouse_id, location_id, product_id, lot_id, condition, quantity, reserved)
      values (p_org, p_wh, p_loc, p_product, p_lot, p_condition, p_qty, coalesce(p_reserved_delta, 0))
      on conflict on constraint stock_balances_dim_uq do update
        set quantity = wms.stock_balances.quantity + excluded.quantity,
            reserved = wms.stock_balances.reserved + excluded.reserved,
            updated_at = now();
    exception when check_violation then
      raise exception using errcode = 'WA409', message = format('Reserva inválida em %s.', v_loc.code), detail = 'reservation_invalid';
    end;
  end if;

  insert into wms.stock_entries (movement_id, organization_id, warehouse_id, location_id, product_id, lot_id, serial_id, condition, quantity)
  values (p_movement, p_org, p_wh, p_loc, p_product, p_lot, p_serial, p_condition, p_qty);
end;
$$;

-- Trava saldos de um conjunto de endereços em ordem determinística (evita deadlock).
create or replace function wms._lock_balances(p_product uuid, p_locations uuid[])
returns void
language sql security definer set search_path = ''
as $$
  select null::void from (
    select 1 from wms.stock_balances
     where product_id = p_product and location_id = any (p_locations)
     order by id
     for update
  ) s;
$$;

-- ---------------------------------------------------------------------
-- Elegibilidade e saldo disponível
-- Disponível = físico elegível − reservas ativas. Fora do elegível: bloqueado,
-- quarentena, avariado, trânsito, endereço bloqueado/em inventário e lote vencido
-- (ou com validade abaixo do mínimo exigido pelo produto).
-- ---------------------------------------------------------------------
create or replace view wms.v_stock_availability
with (security_invoker = true)
as
select b.organization_id, b.warehouse_id, b.location_id, l.code as location_code, l.type as location_type,
       l.pickable, b.product_id, b.lot_id, lt.code as lot_code, lt.expiry_date, b.condition,
       b.quantity, b.reserved,
       (b.condition = 'available'
         and not l.blocked and l.status = 'active' and l.counting_session_id is null
         and l.type in ('storage', 'picking', 'receiving', 'staging', 'packing')
         and (lt.expiry_date is null or lt.expiry_date >= current_date + p.min_shelf_days)) as eligible,
       case when b.condition = 'available'
              and not l.blocked and l.status = 'active' and l.counting_session_id is null
              and l.type in ('storage', 'picking', 'receiving', 'staging', 'packing')
              and (lt.expiry_date is null or lt.expiry_date >= current_date + p.min_shelf_days)
            then b.quantity - b.reserved else 0 end as available
  from wms.stock_balances b
  join wms.locations l on l.id = b.location_id
  join wms.products p on p.id = b.product_id
  left join wms.lots lt on lt.id = b.lot_id;
grant select on wms.v_stock_availability to authenticated;

-- Conferência: projeção x soma do ledger (deve ser vazio). Usado em testes e conciliação.
create or replace function wms.check_balances_against_ledger(p_wh uuid)
returns table (location_id uuid, product_id uuid, lot_id uuid, condition text, balance numeric, ledger numeric)
language sql stable security definer set search_path = ''
as $$
  with l as (
    select e.location_id, e.product_id, e.lot_id, e.condition, sum(e.quantity) as qty
      from wms.stock_entries e where e.warehouse_id = p_wh
     group by 1, 2, 3, 4
  )
  select coalesce(b.location_id, l.location_id), coalesce(b.product_id, l.product_id), coalesce(b.lot_id, l.lot_id),
         coalesce(b.condition, l.condition), coalesce(b.quantity, 0), coalesce(l.qty, 0)
    from (select * from wms.stock_balances where warehouse_id = p_wh) b
    full join l on l.location_id = b.location_id and l.product_id = b.product_id
               and l.lot_id is not distinct from b.lot_id and l.condition = b.condition
   where coalesce(b.quantity, 0) <> coalesce(l.qty, 0);
$$;

-- Reservas ativas x projeção (deve ser vazio)
create or replace function wms.check_reservations_against_balances(p_wh uuid)
returns table (location_id uuid, product_id uuid, lot_id uuid, balance_reserved numeric, reservations numeric)
language sql stable security definer set search_path = ''
as $$
  with r as (
    select location_id, product_id, lot_id, sum(quantity) as qty
      from wms.stock_reservations where warehouse_id = p_wh and status in ('active', 'staged')
     group by 1, 2, 3
  )
  select coalesce(b.location_id, r.location_id), coalesce(b.product_id, r.product_id), coalesce(b.lot_id, r.lot_id),
         coalesce(b.reserved, 0), coalesce(r.qty, 0)
    from (select * from wms.stock_balances where warehouse_id = p_wh and condition = 'available') b
    full join r on r.location_id = b.location_id and r.product_id = b.product_id and r.lot_id is not distinct from b.lot_id
   where coalesce(b.reserved, 0) <> coalesce(r.qty, 0);
$$;

-- Reconstrução da projeção a partir do ledger (manutenção; exige papel do banco, não do app).
create or replace function wms.rebuild_balances(p_wh uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  update wms.stock_balances b set quantity = coalesce(x.qty, 0), updated_at = now()
    from (select b2.id, (select sum(e.quantity) from wms.stock_entries e
                          where e.location_id = b2.location_id and e.product_id = b2.product_id
                            and e.lot_id is not distinct from b2.lot_id and e.condition = b2.condition) as qty
            from wms.stock_balances b2 where b2.warehouse_id = p_wh) x
   where x.id = b.id and b.quantity <> coalesce(x.qty, 0);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Integração: política de lançamento e outbox (gravada na mesma transação)
-- ---------------------------------------------------------------------
create or replace function wms._posting_policy(p_wh uuid, p_direction text)
returns table (connection_id uuid, policy text, deposit_external_id text, write_enabled boolean, connection_status text)
language sql stable security definer set search_path = ''
as $$
  select c.id,
         case when sp.validated_at is null then 'undefined'
              when p_direction = 'outbound' then sp.outbound_policy
              else sp.inbound_policy end,
         d.external_id, c.write_enabled, c.status
    from wms.stock_posting_policies sp
    join wms.integration_connections c on c.id = sp.connection_id
    left join wms.erp_deposits d on d.connection_id = sp.connection_id and d.warehouse_id = sp.warehouse_id
   where sp.warehouse_id = p_wh and c.status <> 'disabled'
   order by c.created_at
   limit 1;
$$;

create or replace function wms._outbox(
  p_org uuid, p_wh uuid, p_connection uuid, p_event_type text, p_aggregate_type text, p_aggregate_id uuid,
  p_payload jsonb, p_dedupe_key text, p_status text default 'pending', p_blocked_reason text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  insert into wms.outbox_events (organization_id, warehouse_id, connection_id, event_type, aggregate_type, aggregate_id,
                                 payload, dedupe_key, status, blocked_reason, correlation_id)
  values (p_org, p_wh, p_connection, p_event_type, p_aggregate_type, p_aggregate_id, p_payload, p_dedupe_key,
          p_status, p_blocked_reason, nullif(current_setting('wms.correlation_id', true), ''))
  on conflict (dedupe_key) do nothing
  returning id into v;
  return v;
end;
$$;

-- Decide como um fato econômico chega ao ERP (antes de gravar o movimento, que é imutável):
--  'none'     armazém sem integração;
--  'erp_side' o ERP já lança (faturamento/nota): o WMS só reconhece, nunca envia segunda baixa;
--  'outbox'   o WMS solicita o lançamento documentado;
--  'blocked'  política ainda não validada: fato registrado e visível, sem envio.
create or replace function wms._erp_posting_mode(p_wh uuid, p_direction text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pol record;
begin
  select * into v_pol from wms._posting_policy(p_wh, p_direction);
  if v_pol.connection_id is null then
    return 'none';
  end if;
  if v_pol.policy in ('erp_on_invoice', 'erp_on_document') then
    return 'erp_side';
  end if;
  if v_pol.policy = (case when p_direction = 'outbound' then 'wms_on_dispatch' else 'wms_on_receipt' end) then
    return 'outbox';
  end if;
  return 'blocked';
end;
$$;

create or replace function wms._erp_enqueue(
  p_org uuid, p_wh uuid, p_direction text, p_mode text, p_movement uuid, p_aggregate_type text, p_aggregate_id uuid, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_pol record;
begin
  if p_mode not in ('outbox', 'blocked') then
    return null;
  end if;
  select * into v_pol from wms._posting_policy(p_wh, p_direction);
  return wms._outbox(p_org, p_wh, v_pol.connection_id,
    case when p_direction = 'outbound' then 'stock.post_outbound' else 'stock.post_inbound' end,
    p_aggregate_type, p_aggregate_id,
    jsonb_build_object('movement_id', p_movement, 'direction', p_direction,
                       'deposit_external_id', v_pol.deposit_external_id, 'lines', p_lines),
    'stock:' || p_movement::text,
    case when p_mode = 'outbox' then 'pending' else 'blocked' end,
    case when p_mode = 'blocked' then 'posting_policy_undefined' end);
end;
$$;

-- Linhas de um movimento agrupadas por produto (para o lançamento agregado no ERP)
create or replace function wms._movement_lines(p_movement uuid, p_sign integer)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'quantity', x.qty) order by x.product_id), '[]'::jsonb)
    from (select e.product_id, sum(e.quantity) * p_sign as qty
            from wms.stock_entries e
           where e.movement_id = p_movement and sign(e.quantity) = p_sign
           group by e.product_id) x;
$$;
