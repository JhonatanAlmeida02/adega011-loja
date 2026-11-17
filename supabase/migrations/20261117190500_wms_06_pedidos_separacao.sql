-- =====================================================================
-- WMS · 06 · Pedidos, reserva, ondas e separação
-- Reserva por armazém/endereço/lote com FEFO; separação move o item para
-- staging mantendo o vínculo com a reserva (sem segunda reserva nem saída).
-- Ordem de travas: pedido → tarefa → item → reserva → saldos (por id).
-- =====================================================================

create or replace function wms._items_hash(p_items jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce((
    select jsonb_agg(jsonb_build_object('p', x->>'product_id', 'q', ((x->>'quantity')::numeric)::text, 'e', coalesce(x->>'external_item_id', ''))
                     order by x->>'product_id', x->>'external_item_id', (x->>'quantity')::numeric)::text
      from jsonb_array_elements(p_items) x), '[]'), 'UTF8')), 'hex');
$$;

-- Insere as linhas; kits com política 'components' viram linhas de componentes.
create or replace function wms._insert_order_items(p_org uuid, p_order uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i record;
  k record;
  v_line integer := coalesce((select max(line_no) from wms.order_items where order_id = p_order), 0);
  v_parent uuid;
  v_prod wms.products;
begin
  for i in select (x->>'product_id')::uuid as product_id, (x->>'quantity')::numeric as quantity, x->>'external_item_id' as ext
             from jsonb_array_elements(p_items) x loop
    select * into v_prod from wms.products where id = i.product_id and organization_id = p_org;
    if not found then
      raise exception using errcode = 'WA422', message = 'Produto do pedido inválido.';
    end if;
    if i.quantity is null or i.quantity <= 0 then
      raise exception using errcode = 'WA422', message = 'Quantidade do pedido deve ser positiva.';
    end if;
    if v_prod.serial_control and i.quantity <> trunc(i.quantity) then
      raise exception using errcode = 'WA422', message = 'Produto com série exige quantidade inteira.';
    end if;
    v_line := v_line + 1;
    if v_prod.kit_policy = 'components' then
      if not exists (select 1 from wms.kit_components where kit_product_id = v_prod.id) then
        raise exception using errcode = 'WA422', message = format('Kit %s sem composição cadastrada.', v_prod.sku);
      end if;
      insert into wms.order_items (organization_id, order_id, line_no, kind, product_id, quantity, external_item_id)
      values (p_org, p_order, v_line, 'kit_parent', v_prod.id, i.quantity, i.ext) returning id into v_parent;
      for k in select component_product_id, quantity from wms.kit_components where kit_product_id = v_prod.id order by component_product_id loop
        v_line := v_line + 1;
        insert into wms.order_items (organization_id, order_id, line_no, kind, kit_parent_item_id, product_id, quantity)
        values (p_org, p_order, v_line, 'kit_component', v_parent, k.component_product_id, k.quantity * i.quantity);
      end loop;
    else
      insert into wms.order_items (organization_id, order_id, line_no, kind, product_id, quantity, external_item_id)
      values (p_org, p_order, v_line, 'product', v_prod.id, i.quantity, i.ext);
    end if;
  end loop;
end;
$$;

create or replace function wms._set_order_status(p_order uuid, p_to text, p_hold_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders;
begin
  select * into v_o from wms.orders where id = p_order;
  perform wms._assert_transition('order', v_o.status, p_to);
  update wms.orders set
    status = p_to,
    status_before_hold = case when p_to = 'on_hold' then v_o.status when v_o.status = 'on_hold' then null else status_before_hold end,
    hold_reason = case when p_to = 'on_hold' then p_hold_reason when v_o.status = 'on_hold' then null else hold_reason end,
    dispatched_at = case when p_to = 'dispatched' then now() else dispatched_at end,
    version = version + 1, updated_at = now()
   where id = p_order;
end;
$$;

-- Pedido manual (sem ERP), restrito a supervisão e auditado. Pedidos do ERP chegam pelo worker.
create or replace function wms.create_manual_order(p_wh uuid, p_number text, p_customer text, p_items jsonb, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_replay jsonb; v_id uuid; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'orders.reconcile', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_manual_order', p_key,
                              jsonb_build_object('wh', p_wh, 'n', p_number, 'c', p_customer, 'i', p_items));
  if v_replay is not null then return v_replay; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'WA422', message = 'Pedido sem itens.';
  end if;
  insert into wms.orders (organization_id, warehouse_id, number, customer_name, items_hash)
  values (v_wh.organization_id, p_wh, trim(p_number), coalesce(p_customer, ''), wms._items_hash(p_items))
  returning id into v_id;
  perform wms._insert_order_items(v_wh.organization_id, v_id, p_items);
  insert into wms.order_revisions (order_id, revision, items_hash, payload)
  values (v_id, 1, wms._items_hash(p_items), jsonb_build_object('items', p_items, 'source', 'manual'));
  perform wms._audit(v_wh.organization_id, p_wh, 'order_created_manual', 'order', v_id::text, jsonb_build_object('number', p_number, 'items', p_items));
  v_result := jsonb_build_object('order_id', v_id, 'status', 'awaiting_allocation');
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Reserva (all-or-nothing) e criação de tarefas por zona
-- ---------------------------------------------------------------------
create or replace function wms._allocate_items(p_order uuid, p_wave uuid, p_item_ids uuid[] default null, p_qty_override jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o wms.orders;
  n record;
  r record;
  v_need numeric;
  v_take numeric;
  v_available numeric;
  v_shortages jsonb := '[]'::jsonb;
  v_task uuid;
  z record;
  v_tasks jsonb := '[]'::jsonb;
  v_res_ids uuid[] := '{}';
  v_res uuid;
begin
  select * into v_o from wms.orders where id = p_order;

  -- Necessidade por produto (linhas de produto e componentes de kit)
  for n in
    select i.product_id, sum(coalesce((p_qty_override ->> i.id::text)::numeric, i.quantity)) as need
      from wms.order_items i
     where i.order_id = p_order and i.kind <> 'kit_parent' and not i.superseded
       and (p_item_ids is null or i.id = any (p_item_ids))
     group by i.product_id order by i.product_id
  loop
    -- Trava os saldos candidatos em ordem determinística
    perform 1 from wms.stock_balances b
      join wms.locations l on l.id = b.location_id
     where b.warehouse_id = v_o.warehouse_id and b.product_id = n.product_id and b.condition = 'available'
       and l.pickable and not l.blocked and l.status = 'active' and l.counting_session_id is null
     order by b.id for update of b;
    select coalesce(sum(b.quantity - b.reserved), 0) into v_available
      from wms.stock_balances b
      join wms.locations l on l.id = b.location_id
      join wms.products p on p.id = b.product_id
      left join wms.lots lt on lt.id = b.lot_id
     where b.warehouse_id = v_o.warehouse_id and b.product_id = n.product_id and b.condition = 'available'
       and l.pickable and not l.blocked and l.status = 'active' and l.counting_session_id is null
       and (lt.expiry_date is null or lt.expiry_date >= current_date + p.min_shelf_days);
    if v_available < n.need then
      v_shortages := v_shortages || jsonb_build_object('product_id', n.product_id, 'needed', n.need, 'available', v_available);
    end if;
  end loop;
  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('status', 'insufficient', 'shortages', v_shortages);
  end if;

  for n in select i.id, i.product_id, coalesce((p_qty_override ->> i.id::text)::numeric, i.quantity) as quantity
             from wms.order_items i
            where i.order_id = p_order and i.kind <> 'kit_parent' and not i.superseded
              and (p_item_ids is null or i.id = any (p_item_ids))
            order by i.product_id, i.line_no
  loop
    v_need := n.quantity;
    for r in
      select b.id, b.location_id, b.lot_id, b.quantity - b.reserved as free
        from wms.stock_balances b
        join wms.locations l on l.id = b.location_id
        join wms.products p on p.id = b.product_id
        left join wms.lots lt on lt.id = b.lot_id
       where b.warehouse_id = v_o.warehouse_id and b.product_id = n.product_id and b.condition = 'available'
         and l.pickable and not l.blocked and l.status = 'active' and l.counting_session_id is null
         and (lt.expiry_date is null or lt.expiry_date >= current_date + p.min_shelf_days)
         and b.quantity - b.reserved > 0
       order by lt.expiry_date nulls last, lt.created_at nulls last, (l.type = 'picking') desc, l.sort_order, l.code
    loop
      exit when v_need <= 0;
      v_take := least(v_need, r.free);
      begin
        update wms.stock_balances set reserved = reserved + v_take, updated_at = now() where id = r.id;
      exception when check_violation then
        raise exception using errcode = 'WA409', message = 'Saldo mudou durante a reserva. Tente novamente.', detail = 'insufficient_stock';
      end;
      insert into wms.stock_reservations (organization_id, warehouse_id, order_id, order_item_id, location_id, product_id, lot_id, quantity, status)
      values (v_o.organization_id, v_o.warehouse_id, p_order, n.id, r.location_id, n.product_id, r.lot_id, v_take, 'active')
      on conflict (order_item_id, location_id, lot_id, status) where status in ('active', 'staged')
      do update set quantity = wms.stock_reservations.quantity + excluded.quantity, updated_at = now()
      returning id into v_res;
      v_res_ids := array_append(v_res_ids, v_res);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception using errcode = 'WA409', message = 'Estoque insuficiente para reservar.', detail = 'insufficient_stock';
    end if;
  end loop;

  -- Uma tarefa por zona; itens na ordem de percurso (sort_order/código)
  for z in select distinct l.zone_id from wms.stock_reservations s join wms.locations l on l.id = s.location_id
            where s.id = any (v_res_ids) loop
    insert into wms.picking_tasks (organization_id, warehouse_id, order_id, wave_id, zone_id)
    values (v_o.organization_id, v_o.warehouse_id, p_order, p_wave, z.zone_id) returning id into v_task;
    insert into wms.picking_items (organization_id, task_id, order_item_id, reservation_id, location_id, product_id, lot_id, quantity)
    select v_o.organization_id, v_task, s.order_item_id, s.id, s.location_id, s.product_id, s.lot_id,
           -- só a quantidade reservada agora nesta chamada (reserva pode ter sido somada a uma existente)
           s.quantity - coalesce((select sum(pi.quantity - pi.short_qty) from wms.picking_items pi
                                   where pi.reservation_id = s.id and pi.status in ('open', 'picked')), 0)
      from wms.stock_reservations s join wms.locations l on l.id = s.location_id
     where s.id = any (v_res_ids) and l.zone_id is not distinct from z.zone_id
     order by l.sort_order, l.code;
    delete from wms.picking_items where task_id = v_task and quantity <= 0;
    v_tasks := v_tasks || jsonb_build_object('task_id', v_task, 'zone_id', z.zone_id);
  end loop;
  return jsonb_build_object('status', 'allocated', 'tasks', v_tasks);
end;
$$;

create or replace function wms.allocate_order(p_order uuid, p_key text, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_replay jsonb; v_alloc jsonb; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  perform wms.require(v_o.organization_id, 'orders.allocate', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'allocate_order', p_key, jsonb_build_object('o', p_order, 'v', p_expected_version));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order for update;
  if p_expected_version is not null and v_o.version <> p_expected_version then
    raise exception using errcode = 'WA409', message = 'Pedido alterado por outro usuário. Atualize a tela.', detail = 'version_conflict';
  end if;
  if v_o.status <> 'awaiting_allocation' then
    raise exception using errcode = 'WA409', message = 'Pedido não está aguardando reserva.', detail = v_o.status;
  end if;
  v_alloc := wms._allocate_items(p_order, null);
  if v_alloc ->> 'status' = 'insufficient' then
    perform wms._discrepancy(v_o.organization_id, v_o.warehouse_id, 'allocation_shortage', 'order', p_order, null, null, null, v_alloc);
    v_result := jsonb_build_object('order_id', p_order, 'status', 'awaiting_allocation', 'allocated', false, 'shortages', v_alloc -> 'shortages');
    return wms._idem_finish(v_o.organization_id, p_key, v_result);
  end if;
  perform wms._set_order_status(p_order, 'allocated');
  update wms.orders set allocated_revision = revision where id = p_order;
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'order_allocated', 'order', p_order::text, v_alloc);
  v_result := jsonb_build_object('order_id', p_order, 'status', 'allocated', 'allocated', true, 'tasks', v_alloc -> 'tasks');
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

-- Onda: agrupa pedidos; cada um é reservado de forma independente (tudo ou nada por pedido).
create or replace function wms.create_wave(p_wh uuid, p_orders uuid[], p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses; v_replay jsonb; v_wave uuid; v_order uuid; v_o wms.orders; v_alloc jsonb;
  v_results jsonb := '[]'::jsonb; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'waves.manage', p_wh);
  perform wms.require(v_wh.organization_id, 'orders.allocate', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_wave', p_key, jsonb_build_object('wh', p_wh, 'o', p_orders));
  if v_replay is not null then return v_replay; end if;
  if p_orders is null or cardinality(p_orders) = 0 then
    raise exception using errcode = 'WA422', message = 'Selecione os pedidos da onda.';
  end if;
  insert into wms.waves (organization_id, warehouse_id, code, created_by)
  values (v_wh.organization_id, p_wh, 'ONDA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD-HH24MISS-') || substr(md5(p_key), 1, 4), auth.uid())
  returning id into v_wave;
  foreach v_order in array (select array_agg(x order by x) from unnest(p_orders) x) loop
    select * into v_o from wms.orders where id = v_order and warehouse_id = p_wh for update;
    if not found or v_o.status <> 'awaiting_allocation' then
      v_results := v_results || jsonb_build_object('order_id', v_order, 'allocated', false, 'reason', coalesce(v_o.status, 'not_found'));
      continue;
    end if;
    v_alloc := wms._allocate_items(v_order, v_wave);
    if v_alloc ->> 'status' = 'insufficient' then
      perform wms._discrepancy(v_o.organization_id, p_wh, 'allocation_shortage', 'order', v_order, null, null, null, v_alloc);
      v_results := v_results || jsonb_build_object('order_id', v_order, 'allocated', false, 'shortages', v_alloc -> 'shortages');
    else
      perform wms._set_order_status(v_order, 'allocated');
      update wms.orders set allocated_revision = revision where id = v_order;
      v_results := v_results || jsonb_build_object('order_id', v_order, 'allocated', true, 'tasks', v_alloc -> 'tasks');
    end if;
  end loop;
  update wms.waves set status = 'released' where id = v_wave;
  perform wms._audit(v_wh.organization_id, p_wh, 'wave_created', 'wave', v_wave::text, jsonb_build_object('results', v_results));
  v_result := jsonb_build_object('wave_id', v_wave, 'results', v_results);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Atribuição (um responsável ativo por tarefa; controle por versão)
-- ---------------------------------------------------------------------
create or replace function wms.claim_picking_task(p_task uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_t wms.picking_tasks; v_uid uuid; v_rows integer;
begin
  select * into v_t from wms.picking_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  v_uid := wms.require(v_t.organization_id, 'picking.execute', v_t.warehouse_id);
  update wms.picking_tasks set assigned_to = v_uid, version = version + 1
   where id = p_task and version = p_expected_version and status in ('open', 'in_progress')
     and (assigned_to is null or assigned_to = v_uid);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using errcode = 'WA409', message = 'Tarefa já atribuída ou alterada. Atualize a lista.', detail = 'version_conflict';
  end if;
  perform wms._audit(v_t.organization_id, v_t.warehouse_id, 'picking_task_claimed', 'picking_task', p_task::text, '{}'::jsonb);
  return jsonb_build_object('task_id', p_task, 'assigned_to', v_uid, 'version', p_expected_version + 1);
end;
$$;

create or replace function wms.assign_picking_task(p_task uuid, p_user uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_t wms.picking_tasks; v_rows integer;
begin
  select * into v_t from wms.picking_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'picking.supervise', v_t.warehouse_id);
  if p_user is not null and not exists (
      select 1 from wms.memberships m
        join wms.profiles pr on pr.user_id = m.user_id and pr.active
        join wms.membership_roles mr on mr.membership_id = m.id
        join wms.role_permissions rp on rp.role_code = mr.role_code and rp.permission_code = 'picking.execute'
       where m.user_id = p_user and m.organization_id = v_t.organization_id and m.active
         and (m.all_warehouses or exists (select 1 from wms.warehouse_access wa where wa.membership_id = m.id and wa.warehouse_id = v_t.warehouse_id))) then
    raise exception using errcode = 'WA422', message = 'Usuário sem permissão de separação neste armazém.';
  end if;
  update wms.picking_tasks set assigned_to = p_user, version = version + 1
   where id = p_task and version = p_expected_version and status in ('open', 'in_progress');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using errcode = 'WA409', message = 'Tarefa alterada por outro usuário. Atualize a lista.', detail = 'version_conflict';
  end if;
  perform wms._audit(v_t.organization_id, v_t.warehouse_id, 'picking_task_assigned', 'picking_task', p_task::text, jsonb_build_object('user_id', p_user));
  return jsonb_build_object('task_id', p_task, 'assigned_to', p_user, 'version', p_expected_version + 1);
end;
$$;

-- ---------------------------------------------------------------------
-- Leitura de separação: endereço + produto + quantidade (+ lote/série)
-- ---------------------------------------------------------------------
create or replace function wms.pick_scan(
  p_task uuid, p_scan_id uuid, p_location_code text, p_code text, p_quantity numeric,
  p_lot_code text default null, p_serial text default null, p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t wms.picking_tasks;
  v_o wms.orders;
  v_wh wms.warehouses;
  v_uid uuid;
  v_replay jsonb;
  v_loc wms.locations;
  v_res record;
  v_prod wms.products;
  v_qty numeric;
  v_lot uuid;
  v_serial uuid;
  v_item wms.picking_items;
  v_resv wms.stock_reservations;
  v_mov uuid;
  v_result jsonb;
begin
  select * into v_t from wms.picking_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  v_uid := wms.require(v_t.organization_id, 'picking.execute', v_t.warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'pick_scan', 'scan:' || p_scan_id::text,
    jsonb_build_object('t', p_task, 'loc', p_location_code, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 's', p_serial, 'p', p_product));
  if v_replay is not null then return v_replay; end if;

  select * into v_o from wms.orders where id = v_t.order_id for update;
  select * into v_t from wms.picking_tasks where id = p_task for update;
  if v_o.status = 'cancelled' then
    raise exception using errcode = 'WA409', message = 'Pedido cancelado: separação bloqueada. Devolva os itens já separados.', detail = 'order_cancelled';
  end if;
  if v_o.status = 'on_hold' then
    raise exception using errcode = 'WA409', message = format('Pedido em espera (%s): separação bloqueada.', coalesce(v_o.hold_reason, '')), detail = 'order_on_hold';
  end if;
  if v_o.status not in ('allocated', 'picking') then
    raise exception using errcode = 'WA409', message = 'Pedido não está em separação.', detail = v_o.status;
  end if;
  if v_t.status not in ('open', 'in_progress') then
    raise exception using errcode = 'WA409', message = 'Tarefa não está aberta.', detail = v_t.status;
  end if;
  if v_t.assigned_to is null then
    update wms.picking_tasks set assigned_to = v_uid where id = p_task;
  elsif v_t.assigned_to <> v_uid and not wms.has_permission(v_t.organization_id, 'picking.supervise', v_t.warehouse_id) then
    raise exception using errcode = 'WA409', message = 'Tarefa atribuída a outro operador.', detail = 'task_assigned_elsewhere';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade deve ser positiva.';
  end if;

  v_loc := wms._location_by_code(v_t.organization_id, v_t.warehouse_id, p_location_code);
  select * into v_res from wms._resolve_one(v_t.organization_id, p_code, p_product);
  select * into v_prod from wms.products where id = v_res.product_id;
  v_qty := p_quantity * v_res.factor;
  v_lot := case when v_prod.lot_control then wms._find_lot(v_prod.id, p_lot_code) end;
  if v_prod.lot_control and v_lot is null then
    raise exception using errcode = 'WA422', message = 'Informe o lote lido.', detail = 'lot_required';
  end if;

  select * into v_item from wms.picking_items
   where task_id = p_task and location_id = v_loc.id and product_id = v_prod.id and lot_id is not distinct from v_lot and status = 'open'
   order by id limit 1 for update;
  if not found then
    if exists (select 1 from wms.picking_items where task_id = p_task and product_id = v_prod.id and status = 'open') then
      raise exception using errcode = 'WA409', message = 'Endereço ou lote diferente do indicado na tarefa.', detail = 'wrong_location';
    end if;
    raise exception using errcode = 'WA409', message = format('Produto %s não está pendente nesta tarefa.', v_prod.sku), detail = 'wrong_product';
  end if;
  if v_qty > v_item.quantity - v_item.picked_qty - v_item.short_qty then
    raise exception using errcode = 'WA409', message = format('Quantidade acima do pendente (%s).', v_item.quantity - v_item.picked_qty - v_item.short_qty), detail = 'over_pick';
  end if;
  if v_prod.serial_control then
    if v_qty <> 1 then
      raise exception using errcode = 'WA422', message = 'Produto com série: leia uma unidade por vez.';
    end if;
    v_serial := wms._find_serial(v_prod.id, p_serial);
    if v_serial is null then
      raise exception using errcode = 'WA422', message = 'Informe o número de série.', detail = 'serial_required';
    end if;
  elsif p_serial is not null then
    raise exception using errcode = 'WA422', message = 'Produto não controla série.';
  end if;

  select * into v_wh from wms.warehouses where id = v_t.warehouse_id;
  select * into v_resv from wms.stock_reservations where id = v_item.reservation_id for update;
  if v_resv.status <> 'active' or v_resv.quantity < v_qty then
    raise exception using errcode = 'WA409', message = 'Reserva inconsistente para esta leitura.', detail = 'reservation_state';
  end if;
  perform wms._lock_balances(v_prod.id, array[v_loc.id, v_wh.staging_location_id]);

  v_mov := wms._new_movement(v_t.organization_id, v_t.warehouse_id, 'pick', 'Separação ' || v_o.number, 'picking_task', p_task, 'scan:' || p_scan_id::text);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.warehouse_id, v_loc.id, v_prod.id, v_lot, v_serial, 'available', -v_qty, -v_qty);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.warehouse_id, v_wh.staging_location_id, v_prod.id, v_lot, v_serial, 'available', v_qty, v_qty);

  update wms.stock_reservations set quantity = quantity - v_qty,
         status = case when quantity - v_qty = 0 then 'consumed' else status end, updated_at = now()
   where id = v_resv.id;
  insert into wms.stock_reservations (organization_id, warehouse_id, order_id, order_item_id, location_id, product_id, lot_id, quantity, status)
  values (v_t.organization_id, v_t.warehouse_id, v_o.id, v_item.order_item_id, v_wh.staging_location_id, v_prod.id, v_lot, v_qty, 'staged')
  on conflict (order_item_id, location_id, lot_id, status) where status in ('active', 'staged')
  do update set quantity = wms.stock_reservations.quantity + excluded.quantity, updated_at = now();

  update wms.picking_items set picked_qty = picked_qty + v_qty,
         status = case when picked_qty + v_qty + short_qty >= quantity then 'picked' else status end
   where id = v_item.id;
  if v_t.status = 'open' then
    update wms.picking_tasks set status = 'in_progress', started_at = now(), version = version + 1 where id = p_task;
  else
    update wms.picking_tasks set version = version + 1 where id = p_task;
  end if;
  if v_o.status = 'allocated' then
    perform wms._set_order_status(v_o.id, 'picking');
  end if;
  insert into wms.scan_events (id, organization_id, warehouse_id, context_type, context_id, user_id, raw_code, product_id, quantity)
  values (p_scan_id, v_t.organization_id, v_t.warehouse_id, 'picking_task', p_task, v_uid, p_code, v_prod.id, v_qty);

  v_result := jsonb_build_object(
    'task_id', p_task, 'item_id', v_item.id, 'product_id', v_prod.id, 'sku', v_prod.sku, 'quantity_base', v_qty,
    'unit', v_res.unit_code, 'factor', v_res.factor, 'movement_id', v_mov,
    'item_remaining', v_item.quantity - v_item.picked_qty - v_item.short_qty - v_qty,
    'task_remaining', (select coalesce(sum(quantity - picked_qty - short_qty), 0) from wms.picking_items where task_id = p_task and status = 'open'));
  return wms._idem_finish(v_t.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

-- Falta na posição: libera a reserva da quantidade não encontrada e registra ocorrência
-- (sem confirmação fictícia). A realocação é uma tentativa explícita e autorizada.
create or replace function wms.pick_short(p_task uuid, p_item uuid, p_quantity numeric, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t wms.picking_tasks; v_o wms.orders; v_item wms.picking_items; v_resv wms.stock_reservations;
  v_replay jsonb; v_disc uuid; v_result jsonb;
begin
  select * into v_t from wms.picking_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'picking.execute', v_t.warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'pick_short', p_key, jsonb_build_object('t', p_task, 'i', p_item, 'q', p_quantity, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = v_t.order_id for update;
  select * into v_t from wms.picking_tasks where id = p_task for update;
  if v_o.status not in ('allocated', 'picking') or v_t.status not in ('open', 'in_progress') then
    raise exception using errcode = 'WA409', message = 'Tarefa/pedido não permite registrar falta agora.';
  end if;
  select * into v_item from wms.picking_items where id = p_item and task_id = p_task for update;
  if not found then raise exception using errcode = 'WA404', message = 'Item não encontrado na tarefa.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > v_item.quantity - v_item.picked_qty - v_item.short_qty then
    raise exception using errcode = 'WA422', message = 'Quantidade de falta inválida.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo da falta.';
  end if;
  select * into v_resv from wms.stock_reservations where id = v_item.reservation_id for update;
  perform 1 from wms.stock_balances where location_id = v_item.location_id and product_id = v_item.product_id
     and lot_id is not distinct from v_item.lot_id and condition = 'available' for update;
  update wms.stock_balances set reserved = reserved - p_quantity, updated_at = now()
   where location_id = v_item.location_id and product_id = v_item.product_id and lot_id is not distinct from v_item.lot_id and condition = 'available';
  update wms.stock_reservations set quantity = quantity - p_quantity,
         status = case when quantity - p_quantity = 0 then 'released' else status end, updated_at = now()
   where id = v_resv.id;
  update wms.picking_items set short_qty = short_qty + p_quantity,
         status = case when picked_qty + short_qty + p_quantity >= quantity then (case when picked_qty = 0 then 'short' else 'picked' end) else status end
   where id = p_item;
  v_disc := wms._discrepancy(v_t.organization_id, v_t.warehouse_id, 'pick_shortage', 'order_item', v_item.order_item_id,
                             v_item.product_id, v_item.location_id, p_quantity,
                             jsonb_build_object('task_id', p_task, 'order_id', v_o.id, 'reason', p_reason));
  perform wms._audit(v_t.organization_id, v_t.warehouse_id, 'pick_shortage', 'picking_item', p_item::text,
                     jsonb_build_object('quantity', p_quantity, 'reason', p_reason, 'discrepancy_id', v_disc));
  v_result := jsonb_build_object('item_id', p_item, 'short_qty', p_quantity, 'discrepancy_id', v_disc);
  return wms._idem_finish(v_t.organization_id, p_key, v_result);
end;
$$;

-- Supervisor tenta realocar a quantidade faltante em outros endereços.
create or replace function wms.reallocate_order_item(p_order_item uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_i wms.order_items; v_o wms.orders; v_replay jsonb; v_missing numeric; v_alloc jsonb; v_result jsonb;
begin
  select * into v_i from wms.order_items where id = p_order_item;
  if not found then raise exception using errcode = 'WA404', message = 'Item não encontrado.'; end if;
  select * into v_o from wms.orders where id = v_i.order_id;
  perform wms.require(v_o.organization_id, 'picking.supervise', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'reallocate_order_item', p_key, jsonb_build_object('i', p_order_item));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = v_i.order_id for update;
  if v_o.status not in ('picking', 'allocated') then
    raise exception using errcode = 'WA409', message = 'Pedido não está em separação.';
  end if;
  select v_i.quantity - coalesce(sum(quantity), 0) into v_missing
    from wms.stock_reservations where order_item_id = p_order_item and status in ('active', 'staged');
  if v_missing <= 0 then
    raise exception using errcode = 'WA409', message = 'Item não tem falta a realocar.';
  end if;
  v_alloc := wms._allocate_items(v_o.id, null, array[p_order_item], jsonb_build_object(p_order_item::text, v_missing));
  if v_alloc ->> 'status' = 'insufficient' then
    v_result := jsonb_build_object('order_item_id', p_order_item, 'reallocated', false, 'shortages', v_alloc -> 'shortages');
  else
    update wms.discrepancies set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = 'Realocado'
     where entity_type = 'order_item' and entity_id = p_order_item and kind = 'pick_shortage' and status = 'open';
    v_result := jsonb_build_object('order_item_id', p_order_item, 'reallocated', true, 'quantity', v_missing, 'tasks', v_alloc -> 'tasks');
  end if;
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'order_item_reallocated', 'order_item', p_order_item::text, v_result);
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

-- Encerra tarefa: só sem itens pendentes. Pedido vira 'picked' quando tudo está em staging.
create or replace function wms.complete_picking_task(p_task uuid, p_key text, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t wms.picking_tasks; v_o wms.orders; v_replay jsonb; v_all_staged boolean; v_status text; v_result jsonb;
begin
  select * into v_t from wms.picking_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'picking.execute', v_t.warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'complete_picking_task', p_key, jsonb_build_object('t', p_task, 'v', p_expected_version));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = v_t.order_id for update;
  select * into v_t from wms.picking_tasks where id = p_task for update;
  if p_expected_version is not null and v_t.version <> p_expected_version then
    raise exception using errcode = 'WA409', message = 'Tarefa alterada. Atualize a tela.', detail = 'version_conflict';
  end if;
  if v_o.status not in ('allocated', 'picking') then
    raise exception using errcode = 'WA409', message = 'Pedido não está em separação.', detail = v_o.status;
  end if;
  if exists (select 1 from wms.picking_items where task_id = p_task and status = 'open') then
    raise exception using errcode = 'WA409', message = 'Há itens pendentes: leia ou registre a falta.', detail = 'items_pending';
  end if;
  perform wms._assert_transition('picking_task', v_t.status, 'completed');
  update wms.picking_tasks set status = 'completed', completed_at = now(), version = version + 1 where id = p_task;

  select bool_and(coalesce(s.qty, 0) = i.quantity) into v_all_staged
    from wms.order_items i
    left join (select order_item_id, sum(quantity) as qty from wms.stock_reservations
                where order_id = v_o.id and status = 'staged' group by order_item_id) s on s.order_item_id = i.id
   where i.order_id = v_o.id and i.kind <> 'kit_parent' and not i.superseded;
  v_status := v_o.status;
  if v_all_staged and not exists (select 1 from wms.picking_tasks where order_id = v_o.id and status in ('open', 'in_progress')) then
    if v_o.status = 'allocated' then perform wms._set_order_status(v_o.id, 'picking'); end if;
    perform wms._set_order_status(v_o.id, 'picked');
    v_status := 'picked';
  end if;
  perform wms._audit(v_t.organization_id, v_t.warehouse_id, 'picking_task_completed', 'picking_task', p_task::text, jsonb_build_object('order_status', v_status));
  v_result := jsonb_build_object('task_id', p_task, 'status', 'completed', 'order_status', v_status,
                                 'pending_shortage', not coalesce(v_all_staged, false));
  return wms._idem_finish(v_t.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Liberação de estoque do pedido (cancelamento / reconciliação)
-- Antes do picking: libera reserva. Depois: libera e cria tarefa de retorno físico.
-- ---------------------------------------------------------------------
create or replace function wms._release_order_stock(p_order uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o wms.orders;
  r record;
  s record;
  v_returns integer := 0;
  v_released numeric := 0;
begin
  select * into v_o from wms.orders where id = p_order;
  for r in select * from wms.stock_reservations where order_id = p_order and status in ('active', 'staged') and quantity > 0
            order by location_id, product_id, id for update loop
    update wms.stock_balances set reserved = reserved - r.quantity, updated_at = now()
     where location_id = r.location_id and product_id = r.product_id and lot_id is not distinct from r.lot_id and condition = 'available';
    update wms.stock_reservations set status = 'released', updated_at = now() where id = r.id;
    v_released := v_released + r.quantity;
    if r.status = 'staged' then
      if exists (select 1 from wms.products where id = r.product_id and serial_control) then
        -- uma tarefa por série separada para este pedido que ainda está em staging
        for s in select distinct sn.id from wms.serial_numbers sn
                   join wms.stock_entries e on e.serial_id = sn.id and e.quantity > 0 and e.location_id = r.location_id
                   join wms.stock_movements m on m.id = e.movement_id and m.movement_type = 'pick' and m.reference_type = 'picking_task'
                   join wms.picking_tasks t on t.id = m.reference_id and t.order_id = p_order
                  where sn.product_id = r.product_id and sn.location_id = r.location_id and sn.lot_id is not distinct from r.lot_id loop
          perform wms._new_putaway_task(v_o.organization_id, v_o.warehouse_id, 'return_to_stock', 'order', p_order,
                                        r.product_id, r.lot_id, s.id, 'available', r.location_id, 1);
          v_returns := v_returns + 1;
        end loop;
      else
        perform wms._new_putaway_task(v_o.organization_id, v_o.warehouse_id, 'return_to_stock', 'order', p_order,
                                      r.product_id, r.lot_id, null, 'available', r.location_id, r.quantity);
        v_returns := v_returns + 1;
      end if;
    end if;
  end loop;
  update wms.picking_items set status = 'cancelled'
   where status = 'open' and task_id in (select id from wms.picking_tasks where order_id = p_order);
  update wms.picking_tasks set status = 'cancelled', version = version + 1
   where order_id = p_order and status in ('open', 'in_progress', 'invalidated');
  delete from wms.shipment_packages sp using wms.shipments sh
   where sp.order_id = p_order and sh.id = sp.shipment_id and sh.status in ('open', 'loading');
  update wms.packages set status = 'voided' where order_id = p_order and status in ('open', 'closed');
  update wms.packing_checks set status = 'cancelled' where order_id = p_order and status = 'open';
  return jsonb_build_object('released_qty', v_released, 'return_tasks', v_returns, 'reason', p_reason);
end;
$$;

create or replace function wms._cancel_order_internal(p_order uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_rel jsonb;
begin
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status = 'cancelled' then
    return jsonb_build_object('order_id', p_order, 'status', 'cancelled', 'already', true);
  end if;
  if v_o.status in ('dispatched', 'partially_dispatched') then
    raise exception using errcode = 'WA409', message = 'Pedido já despachado: use o fluxo de devolução.', detail = 'already_dispatched';
  end if;
  v_rel := wms._release_order_stock(p_order, p_reason);
  perform wms._set_order_status(p_order, 'cancelled');
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'order_cancelled', 'order', p_order::text,
                     v_rel || jsonb_build_object('previous_status', v_o.status));
  return jsonb_build_object('order_id', p_order, 'status', 'cancelled', 'previous_status', v_o.status) || v_rel;
end;
$$;

create or replace function wms.cancel_order(p_order uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_replay jsonb; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  perform wms.require(v_o.organization_id, 'orders.cancel', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'cancel_order', p_key, jsonb_build_object('o', p_order, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo do cancelamento.';
  end if;
  v_result := wms._cancel_order_internal(p_order, p_reason);
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

-- Pedido alterado no ERP após a reserva: espera + tarefas invalidadas (nada desatualizado avança).
create or replace function wms._hold_order_for_revision(p_order uuid, p_new_revision integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders;
begin
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status = 'on_hold' then
    return;
  end if;
  perform wms._set_order_status(p_order, 'on_hold', 'revision_changed');
  update wms.picking_tasks set status = 'invalidated', version = version + 1
   where order_id = p_order and status in ('open', 'in_progress');
  perform wms._discrepancy(v_o.organization_id, v_o.warehouse_id, 'order_revision_changed', 'order', p_order, null, null, null,
                           jsonb_build_object('from_revision', v_o.allocated_revision, 'to_revision', p_new_revision, 'status', v_o.status));
end;
$$;

-- Reconciliação: libera tudo do pedido, aplica a revisão mais recente e volta para reserva.
create or replace function wms.reconcile_order_revision(p_order uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_replay jsonb; v_rev wms.order_revisions; v_rel jsonb; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  perform wms.require(v_o.organization_id, 'orders.reconcile', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'reconcile_order_revision', p_key, jsonb_build_object('o', p_order));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status <> 'on_hold' or v_o.hold_reason <> 'revision_changed' then
    raise exception using errcode = 'WA409', message = 'Pedido não está aguardando reconciliação de revisão.';
  end if;
  select * into v_rev from wms.order_revisions where order_id = p_order order by revision desc limit 1;
  v_rel := wms._release_order_stock(p_order, 'revision_changed');
  -- Linhas antigas ficam como histórico (referenciadas por reservas/ledger); novas linhas seguem a numeração.
  update wms.order_items set superseded = true where order_id = p_order and not superseded;
  perform wms._insert_order_items(v_o.organization_id, p_order, v_rev.payload -> 'items');
  update wms.orders set items_hash = v_rev.items_hash, allocated_revision = null where id = p_order;
  perform wms._set_order_status(p_order, 'awaiting_allocation');
  update wms.discrepancies set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = 'Revisão reconciliada'
   where entity_type = 'order' and entity_id = p_order and kind = 'order_revision_changed' and status = 'open';
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'order_revision_reconciled', 'order', p_order::text,
                     v_rel || jsonb_build_object('revision', v_rev.revision));
  v_result := jsonb_build_object('order_id', p_order, 'status', 'awaiting_allocation', 'revision', v_rev.revision) || v_rel;
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;
