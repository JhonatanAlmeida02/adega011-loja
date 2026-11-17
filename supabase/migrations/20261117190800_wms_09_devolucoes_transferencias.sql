-- =====================================================================
-- WMS · 09 · Devoluções e qualidade, transferências entre armazéns e
-- reabastecimento. Retorno físico e estorno fiscal são eventos distintos:
-- aqui só o físico; o fiscal continua no ERP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Devoluções
-- ---------------------------------------------------------------------
create or replace function wms.create_return(p_wh uuid, p_order uuid, p_reason text, p_items jsonb, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_o wms.orders; v_replay jsonb; v_id uuid; i record; v_dispatched numeric; v_returned numeric; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'returns.manage', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_return', p_key, jsonb_build_object('wh', p_wh, 'o', p_order, 'r', p_reason, 'i', p_items));
  if v_replay is not null then return v_replay; end if;
  if p_order is not null then
    select * into v_o from wms.orders where id = p_order and organization_id = v_wh.organization_id;
    if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
    if v_o.status <> 'dispatched' then
      raise exception using errcode = 'WA409', message = 'Devolução vinculada exige pedido despachado.';
    end if;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'WA422', message = 'Informe os itens devolvidos.';
  end if;
  insert into wms.returns (organization_id, warehouse_id, order_id, code, reason, created_by)
  values (v_wh.organization_id, p_wh, p_order, 'DEV-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD-') || upper(substr(md5(p_key), 1, 6)),
          coalesce(p_reason, ''), auth.uid())
  returning id into v_id;
  for i in select (x->>'product_id')::uuid as product_id, (x->>'quantity')::numeric as quantity from jsonb_array_elements(p_items) x loop
    if i.quantity is null or i.quantity <= 0 then
      raise exception using errcode = 'WA422', message = 'Quantidade devolvida inválida.';
    end if;
    if p_order is not null then
      select coalesce(sum(-e.quantity), 0) into v_dispatched
        from wms.stock_entries e join wms.stock_movements m on m.id = e.movement_id
       where m.movement_type = 'dispatch' and m.reference_type = 'order' and m.reference_id = p_order and e.product_id = i.product_id;
      select coalesce(sum(ri.expected_qty), 0) into v_returned
        from wms.return_items ri join wms.returns r on r.id = ri.return_id
       where r.order_id = p_order and r.status <> 'cancelled' and ri.product_id = i.product_id;
      if i.quantity + v_returned > v_dispatched then
        raise exception using errcode = 'WA409', message = 'Quantidade devolvida maior que a expedida no pedido.';
      end if;
    end if;
    insert into wms.return_items (organization_id, return_id, product_id, expected_qty)
    values (v_wh.organization_id, v_id, i.product_id, i.quantity);
  end loop;
  perform wms._audit(v_wh.organization_id, p_wh, 'return_created', 'return', v_id::text, jsonb_build_object('order_id', p_order, 'items', p_items));
  v_result := jsonb_build_object('return_id', v_id, 'status', 'expected');
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
exception when foreign_key_violation then
  raise exception using errcode = 'WA422', message = 'Produto inválido.';
end;
$$;

-- Recebimento da devolução: sempre entra em quarentena no endereço de devoluções.
create or replace function wms.receive_return_item(
  p_return uuid, p_scan_id uuid, p_code text, p_quantity numeric, p_lot_code text default null,
  p_expiry date default null, p_serial text default null, p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r wms.returns; v_wh wms.warehouses; v_replay jsonb; v_res record; v_prod wms.products; v_item wms.return_items;
  v_qty numeric; v_lot uuid; v_serial uuid; v_mov uuid; v_result jsonb;
begin
  select * into v_r from wms.returns where id = p_return;
  if not found then raise exception using errcode = 'WA404', message = 'Devolução não encontrada.'; end if;
  perform wms.require(v_r.organization_id, 'returns.receive', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'receive_return_item', 'scan:' || p_scan_id::text,
    jsonb_build_object('r', p_return, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 'e', p_expiry, 's', p_serial, 'p', p_product));
  if v_replay is not null then return v_replay; end if;
  select * into v_r from wms.returns where id = p_return for update;
  if v_r.status not in ('expected', 'receiving') then
    raise exception using errcode = 'WA409', message = 'Devolução não está em recebimento.';
  end if;
  select * into v_res from wms._resolve_one(v_r.organization_id, p_code, p_product);
  select * into v_prod from wms.products where id = v_res.product_id;
  v_qty := p_quantity * v_res.factor;
  select * into v_item from wms.return_items where return_id = p_return and product_id = v_prod.id for update;
  if not found then
    raise exception using errcode = 'WA409', message = 'Produto não previsto nesta devolução.', detail = 'unexpected_product';
  end if;
  if v_item.received_qty + v_qty > v_item.expected_qty then
    raise exception using errcode = 'WA409', message = 'Quantidade acima da prevista na devolução.';
  end if;
  select * into v_wh from wms.warehouses where id = v_r.warehouse_id;
  v_lot := wms._ensure_lot(v_r.organization_id, v_prod.id, p_lot_code, p_expiry);
  if v_prod.serial_control then
    v_serial := wms._ensure_serial(v_r.organization_id, v_prod.id, p_serial, v_lot);
  elsif p_serial is not null then
    raise exception using errcode = 'WA422', message = 'Produto não controla série.';
  end if;
  v_mov := wms._new_movement(v_r.organization_id, v_r.warehouse_id, 'return_receipt', 'Devolução ' || v_r.code, 'return', p_return, 'scan:' || p_scan_id::text);
  perform wms._post_entry(v_mov, v_r.organization_id, v_r.warehouse_id, v_wh.returns_location_id, v_prod.id, v_lot, v_serial, 'quarantine', v_qty);
  update wms.return_items set received_qty = received_qty + v_qty where id = v_item.id;
  update wms.returns set status = 'receiving', version = version + 1 where id = p_return and status = 'expected';
  insert into wms.scan_events (id, organization_id, warehouse_id, context_type, context_id, user_id, raw_code, product_id, quantity)
  values (p_scan_id, v_r.organization_id, v_r.warehouse_id, 'return', p_return, auth.uid(), p_code, v_prod.id, v_qty);
  v_result := jsonb_build_object('return_id', p_return, 'product_id', v_prod.id, 'sku', v_prod.sku, 'quantity_base', v_qty, 'movement_id', v_mov);
  return wms._idem_finish(v_r.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

-- Decisão de qualidade sobre estoque em quarentena/avariado (devolução ou recebimento).
create or replace function wms.decide_quality(
  p_wh uuid, p_from_code text, p_product uuid, p_lot_code text, p_serial text, p_from_condition text,
  p_quantity numeric, p_decision text, p_to_code text, p_notes text, p_return_item uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses; v_uid uuid; v_replay jsonb; v_from wms.locations; v_to wms.locations; v_lot uuid; v_serial uuid;
  v_mov uuid; v_dec uuid; v_type text; v_ri wms.return_items; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  v_uid := wms.require(v_wh.organization_id, 'quality.decide', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'decide_quality', p_key,
    jsonb_build_object('wh', p_wh, 'f', p_from_code, 'p', p_product, 'l', p_lot_code, 's', p_serial, 'c', p_from_condition,
                       'q', p_quantity, 'd', p_decision, 't', p_to_code, 'n', p_notes, 'ri', p_return_item));
  if v_replay is not null then return v_replay; end if;
  if p_decision not in ('reintegrate', 'repair', 'discard', 'return_to_supplier') then
    raise exception using errcode = 'WA422', message = 'Decisão inválida.';
  end if;
  if p_from_condition not in ('quarantine', 'damaged', 'blocked') then
    raise exception using errcode = 'WA422', message = 'Decisão de qualidade só para estoque em quarentena, avariado ou bloqueado.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade inválida.';
  end if;
  if not exists (select 1 from wms.products where id = p_product and organization_id = v_wh.organization_id) then
    raise exception using errcode = 'WA422', message = 'Produto inválido.';
  end if;
  v_from := wms._location_by_code(v_wh.organization_id, p_wh, p_from_code);
  v_lot := wms._find_lot(p_product, p_lot_code);
  v_serial := wms._find_serial(p_product, p_serial);
  if p_return_item is not null then
    select * into v_ri from wms.return_items where id = p_return_item and product_id = p_product for update;
    if not found then raise exception using errcode = 'WA404', message = 'Item de devolução não encontrado.'; end if;
    if v_ri.decided_qty + p_quantity > v_ri.received_qty then
      raise exception using errcode = 'WA409', message = 'Quantidade maior que a recebida sem decisão.';
    end if;
  end if;
  v_type := case p_decision when 'reintegrate' then 'condition_change' when 'repair' then 'condition_change'
                            when 'discard' then 'scrap' else 'supplier_return' end;
  v_mov := wms._new_movement(v_wh.organization_id, p_wh, v_type, 'Qualidade: ' || p_decision, 'quality', p_return_item, p_key,
                             case when p_decision in ('discard', 'return_to_supplier')
                                  and (select connection_id from wms._posting_policy(p_wh, 'outbound')) is not null then 'blocked' else 'none' end);
  perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_from.id, p_product, v_lot, v_serial, p_from_condition, -p_quantity);
  if p_decision = 'reintegrate' then
    if p_to_code is null then raise exception using errcode = 'WA422', message = 'Informe o endereço de destino.'; end if;
    v_to := wms._location_by_code(v_wh.organization_id, p_wh, p_to_code);
    if v_to.type not in ('storage', 'picking') then
      raise exception using errcode = 'WA422', message = 'Reintegração vai para armazenagem ou separação.';
    end if;
    perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_to.id, p_product, v_lot, v_serial, 'available', p_quantity);
  elsif p_decision = 'repair' then
    v_to := coalesce(case when p_to_code is not null then wms._location_by_code(v_wh.organization_id, p_wh, p_to_code) end, v_from);
    perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_to.id, p_product, v_lot, v_serial, 'damaged', p_quantity);
  else
    if v_serial is not null then
      update wms.serial_numbers set status = case when p_decision = 'discard' then 'scrapped' else 'returned_to_supplier' end where id = v_serial;
    end if;
    if (select connection_id from wms._posting_policy(p_wh, 'outbound')) is not null then
      perform wms._outbox(v_wh.organization_id, p_wh, (select connection_id from wms._posting_policy(p_wh, 'outbound')),
        'stock.post_quality_exit', 'quality', v_mov,
        jsonb_build_object('movement_id', v_mov, 'decision', p_decision, 'product_id', p_product, 'quantity', p_quantity),
        'stock:' || v_mov::text, 'blocked', 'quality_exit_policy_undefined');
    end if;
  end if;
  insert into wms.quality_decisions (organization_id, warehouse_id, return_item_id, product_id, lot_id, serial_id, from_location_id,
                                     to_location_id, decision, quantity, notes, decided_by, movement_id)
  values (v_wh.organization_id, p_wh, p_return_item, p_product, v_lot, v_serial, v_from.id, v_to.id, p_decision, p_quantity,
          coalesce(p_notes, ''), v_uid, v_mov)
  returning id into v_dec;
  if p_return_item is not null then
    update wms.return_items set decided_qty = decided_qty + p_quantity where id = p_return_item;
    update wms.returns r set status = case when not exists (select 1 from wms.return_items ri where ri.return_id = r.id and ri.decided_qty < ri.expected_qty)
                                           then 'closed' else 'inspection' end,
           closed_at = case when not exists (select 1 from wms.return_items ri where ri.return_id = r.id and ri.decided_qty < ri.expected_qty) then now() end,
           version = version + 1
     where r.id = v_ri.return_id;
  end if;
  perform wms._audit(v_wh.organization_id, p_wh, 'quality_decided', 'quality_decision', v_dec::text,
                     jsonb_build_object('decision', p_decision, 'quantity', p_quantity, 'movement_id', v_mov));
  v_result := jsonb_build_object('decision_id', v_dec, 'movement_id', v_mov, 'decision', p_decision);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Transferência entre armazéns: expede para trânsito, recebe no destino.
-- Lançamento entre depósitos no ERP exige fluxo validado (fica bloqueado).
-- ---------------------------------------------------------------------
create or replace function wms.create_transfer_order(p_from_wh uuid, p_to_wh uuid, p_items jsonb, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_from wms.warehouses; v_to wms.warehouses; v_replay jsonb; v_id uuid; i record; v_loc wms.locations; v_result jsonb;
begin
  select * into v_from from wms.warehouses where id = p_from_wh;
  select * into v_to from wms.warehouses where id = p_to_wh;
  if v_from.id is null or v_to.id is null or v_from.organization_id <> v_to.organization_id then
    raise exception using errcode = 'WA404', message = 'Armazéns inválidos.';
  end if;
  perform wms.require(v_from.organization_id, 'transfers.manage', p_from_wh);
  perform wms.require(v_from.organization_id, 'transfers.manage', p_to_wh);
  v_replay := wms._idem_begin(v_from.organization_id, 'create_transfer_order', p_key, jsonb_build_object('f', p_from_wh, 't', p_to_wh, 'i', p_items));
  if v_replay is not null then return v_replay; end if;
  insert into wms.transfer_orders (organization_id, from_warehouse_id, to_warehouse_id, code, created_by)
  values (v_from.organization_id, p_from_wh, p_to_wh, 'TRF-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD-') || upper(substr(md5(p_key), 1, 6)), auth.uid())
  returning id into v_id;
  for i in select (x->>'product_id')::uuid as product_id, x->>'lot_code' as lot_code, x->>'location_code' as location_code,
                  (x->>'quantity')::numeric as quantity from jsonb_array_elements(p_items) x loop
    v_loc := wms._location_by_code(v_from.organization_id, p_from_wh, i.location_code);
    if exists (select 1 from wms.products where id = i.product_id and serial_control) then
      raise exception using errcode = 'WA422', message = 'Transferência de produto com série ainda não implementada.', detail = 'serial_transfer_pending';
    end if;
    insert into wms.transfer_items (organization_id, transfer_id, product_id, lot_id, from_location_id, quantity)
    values (v_from.organization_id, v_id, i.product_id, wms._find_lot(i.product_id, i.lot_code), v_loc.id, i.quantity);
  end loop;
  perform wms._audit(v_from.organization_id, p_from_wh, 'transfer_created', 'transfer_order', v_id::text, jsonb_build_object('items', p_items, 'to', p_to_wh));
  v_result := jsonb_build_object('transfer_id', v_id, 'status', 'draft');
  return wms._idem_finish(v_from.organization_id, p_key, v_result);
exception when check_violation or foreign_key_violation then
  raise exception using errcode = 'WA422', message = 'Item de transferência inválido.';
end;
$$;

create or replace function wms.ship_transfer_order(p_transfer uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_t wms.transfer_orders; v_to wms.warehouses; v_replay jsonb; v_mov uuid; v_mov_in uuid; i record; v_result jsonb;
begin
  select * into v_t from wms.transfer_orders where id = p_transfer;
  if not found then raise exception using errcode = 'WA404', message = 'Transferência não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'transfers.manage', v_t.from_warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'ship_transfer_order', p_key, jsonb_build_object('t', p_transfer));
  if v_replay is not null then return v_replay; end if;
  select * into v_t from wms.transfer_orders where id = p_transfer for update;
  perform wms._assert_transition('transfer', v_t.status, 'in_transit');
  select * into v_to from wms.warehouses where id = v_t.to_warehouse_id;
  v_mov := wms._new_movement(v_t.organization_id, v_t.from_warehouse_id, 'transfer_out', 'Transferência ' || v_t.code, 'transfer_order', p_transfer, p_key,
                             case when (select connection_id from wms._posting_policy(v_t.from_warehouse_id, 'outbound')) is null then 'none' else 'blocked' end);
  v_mov_in := wms._new_movement(v_t.organization_id, v_t.to_warehouse_id, 'transfer_out', 'Trânsito ' || v_t.code, 'transfer_order', p_transfer, p_key || ':transit');
  for i in select * from wms.transfer_items where transfer_id = p_transfer order by product_id, from_location_id loop
    perform wms._post_entry(v_mov, v_t.organization_id, v_t.from_warehouse_id, i.from_location_id, i.product_id, i.lot_id, null, 'available', -i.quantity);
    perform wms._post_entry(v_mov_in, v_t.organization_id, v_t.to_warehouse_id, v_to.transit_location_id, i.product_id, i.lot_id, null, 'in_transit', i.quantity);
    update wms.transfer_items set shipped_qty = quantity where id = i.id;
  end loop;
  if (select connection_id from wms._posting_policy(v_t.from_warehouse_id, 'outbound')) is not null then
    perform wms._outbox(v_t.organization_id, v_t.from_warehouse_id, (select connection_id from wms._posting_policy(v_t.from_warehouse_id, 'outbound')),
      'stock.transfer_between_deposits', 'transfer_order', p_transfer, jsonb_build_object('movement_id', v_mov, 'transfer_id', p_transfer),
      'stock:' || v_mov::text, 'blocked', 'inter_deposit_flow_not_validated');
  end if;
  update wms.transfer_orders set status = 'in_transit', shipped_at = now(), version = version + 1 where id = p_transfer;
  perform wms._audit(v_t.organization_id, v_t.from_warehouse_id, 'transfer_shipped', 'transfer_order', p_transfer::text, jsonb_build_object('movement_id', v_mov));
  v_result := jsonb_build_object('transfer_id', p_transfer, 'status', 'in_transit', 'movement_id', v_mov);
  return wms._idem_finish(v_t.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.receive_transfer_item(
  p_transfer uuid, p_scan_id uuid, p_code text, p_quantity numeric, p_lot_code text default null, p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t wms.transfer_orders; v_to wms.warehouses; v_replay jsonb; v_res record; v_qty numeric; v_lot uuid; v_item wms.transfer_items;
  v_mov uuid; v_result jsonb;
begin
  select * into v_t from wms.transfer_orders where id = p_transfer;
  if not found then raise exception using errcode = 'WA404', message = 'Transferência não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'transfers.receive', v_t.to_warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'receive_transfer_item', 'scan:' || p_scan_id::text,
    jsonb_build_object('t', p_transfer, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 'p', p_product));
  if v_replay is not null then return v_replay; end if;
  select * into v_t from wms.transfer_orders where id = p_transfer for update;
  if v_t.status <> 'in_transit' then
    raise exception using errcode = 'WA409', message = 'Transferência não está em trânsito.';
  end if;
  select * into v_res from wms._resolve_one(v_t.organization_id, p_code, p_product);
  v_qty := p_quantity * v_res.factor;
  v_lot := wms._find_lot(v_res.product_id, p_lot_code);
  select * into v_item from wms.transfer_items
   where transfer_id = p_transfer and product_id = v_res.product_id and lot_id is not distinct from v_lot and received_qty < shipped_qty
   order by id limit 1 for update;
  if not found then
    raise exception using errcode = 'WA409', message = 'Produto/lote não pendente nesta transferência.', detail = 'unexpected_product';
  end if;
  if v_item.received_qty + v_qty > v_item.shipped_qty then
    raise exception using errcode = 'WA409', message = 'Quantidade acima da expedida.';
  end if;
  select * into v_to from wms.warehouses where id = v_t.to_warehouse_id;
  v_mov := wms._new_movement(v_t.organization_id, v_t.to_warehouse_id, 'transfer_in', 'Recebimento ' || v_t.code, 'transfer_order', p_transfer, 'scan:' || p_scan_id::text);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.to_warehouse_id, v_to.transit_location_id, v_res.product_id, v_lot, null, 'in_transit', -v_qty);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.to_warehouse_id, v_to.receiving_location_id, v_res.product_id, v_lot, null, 'available', v_qty);
  update wms.transfer_items set received_qty = received_qty + v_qty where id = v_item.id;
  perform wms._new_putaway_task(v_t.organization_id, v_t.to_warehouse_id, 'putaway', 'transfer_order', p_transfer,
                                v_res.product_id, v_lot, null, 'available', v_to.receiving_location_id, v_qty);
  if not exists (select 1 from wms.transfer_items where transfer_id = p_transfer and received_qty < shipped_qty) then
    update wms.transfer_orders set status = 'received', closed_at = now(), version = version + 1 where id = p_transfer;
  end if;
  v_result := jsonb_build_object('transfer_id', p_transfer, 'quantity_base', v_qty, 'movement_id', v_mov,
                                 'status', (select status from wms.transfer_orders where id = p_transfer));
  return wms._idem_finish(v_t.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

-- Diferença no destino: encerra com ocorrência; o saldo faltante permanece em trânsito (visível) até a apuração.
create or replace function wms.close_transfer_with_discrepancy(p_transfer uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_t wms.transfer_orders; v_replay jsonb; i record; v_result jsonb;
begin
  select * into v_t from wms.transfer_orders where id = p_transfer;
  if not found then raise exception using errcode = 'WA404', message = 'Transferência não encontrada.'; end if;
  perform wms.require(v_t.organization_id, 'discrepancies.resolve', v_t.to_warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'close_transfer_with_discrepancy', p_key, jsonb_build_object('t', p_transfer, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  select * into v_t from wms.transfer_orders where id = p_transfer for update;
  perform wms._assert_transition('transfer', v_t.status, 'closed_with_discrepancy');
  for i in select * from wms.transfer_items where transfer_id = p_transfer and received_qty < shipped_qty loop
    perform wms._discrepancy(v_t.organization_id, v_t.to_warehouse_id, 'transfer_shortage', 'transfer_item', i.id, i.product_id,
                             null, i.shipped_qty - i.received_qty, jsonb_build_object('transfer_id', p_transfer, 'reason', p_reason));
  end loop;
  update wms.transfer_orders set status = 'closed_with_discrepancy', closed_at = now(), version = version + 1 where id = p_transfer;
  perform wms._audit(v_t.organization_id, v_t.to_warehouse_id, 'transfer_closed_discrepancy', 'transfer_order', p_transfer::text, jsonb_build_object('reason', p_reason));
  v_result := jsonb_build_object('transfer_id', p_transfer, 'status', 'closed_with_discrepancy');
  return wms._idem_finish(v_t.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Reabastecimento do picking a partir da armazenagem (sem saldo artificial)
-- ---------------------------------------------------------------------
create or replace function wms.generate_replenishment(p_wh uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses; v_replay jsonb; lp record; src record; v_current numeric; v_need numeric; v_take numeric;
  v_created integer := 0; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'stock.putaway', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'generate_replenishment', p_key, jsonb_build_object('wh', p_wh));
  if v_replay is not null then return v_replay; end if;
  for lp in select x.*, l.code from wms.location_products x join wms.locations l on l.id = x.location_id
             where x.warehouse_id = p_wh and not l.blocked and l.counting_session_id is null order by l.code loop
    select coalesce(sum(quantity), 0) into v_current from wms.stock_balances
     where location_id = lp.location_id and product_id = lp.product_id and condition = 'available';
    v_current := v_current + coalesce((select sum(quantity) from wms.putaway_tasks where kind = 'replenishment' and status = 'open'
                                        and suggested_location_id = lp.location_id and product_id = lp.product_id), 0);
    continue when v_current >= lp.min_qty;
    v_need := lp.max_qty - v_current;
    for src in select b.location_id, b.lot_id, b.quantity - b.reserved
                      - coalesce((select sum(t.quantity) from wms.putaway_tasks t where t.status = 'open' and t.from_location_id = b.location_id
                                   and t.product_id = b.product_id and t.lot_id is not distinct from b.lot_id), 0) as free
                 from wms.stock_balances b
                 join wms.locations l on l.id = b.location_id
                 left join wms.lots lt on lt.id = b.lot_id
                where b.warehouse_id = p_wh and b.product_id = lp.product_id and b.condition = 'available'
                  and l.type = 'storage' and not l.blocked and l.counting_session_id is null and b.location_id <> lp.location_id
                order by lt.expiry_date nulls last, l.sort_order, l.code loop
      exit when v_need <= 0;
      continue when src.free <= 0;
      v_take := least(v_need, src.free);
      perform wms._new_putaway_task(v_wh.organization_id, p_wh, 'replenishment', 'location_product', lp.location_id,
                                    lp.product_id, src.lot_id, null, 'available', src.location_id, v_take, lp.location_id);
      v_need := v_need - v_take;
      v_created := v_created + 1;
    end loop;
  end loop;
  v_result := jsonb_build_object('tasks_created', v_created);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;
