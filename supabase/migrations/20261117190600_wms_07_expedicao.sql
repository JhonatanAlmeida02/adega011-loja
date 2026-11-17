-- =====================================================================
-- WMS · 07 · Conferência, embalagem, remessa e despacho
-- Despacho é evento explícito (nunca consequência de imprimir etiqueta).
-- Consome o estoque de staging e encerra a reserva uma única vez.
-- =====================================================================

create or replace function wms.start_packing(p_order uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_uid uuid; v_replay jsonb; v_check uuid; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  v_uid := wms.require(v_o.organization_id, 'packing.execute', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'start_packing', p_key, jsonb_build_object('o', p_order));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status <> 'picked' then
    raise exception using errcode = 'WA409', message = 'Pedido precisa estar separado para conferir.', detail = v_o.status;
  end if;
  insert into wms.packing_checks (organization_id, warehouse_id, order_id, started_by)
  values (v_o.organization_id, v_o.warehouse_id, p_order, v_uid)
  on conflict (order_id) do update set status = 'open', started_by = excluded.started_by, started_at = now(), completed_at = null
  returning id into v_check;
  perform wms._set_order_status(p_order, 'checking');
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'packing_started', 'order', p_order::text, '{}'::jsonb);
  v_result := jsonb_build_object('order_id', p_order, 'packing_check_id', v_check, 'status', 'checking');
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.open_package(p_order uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_uid uuid; v_replay jsonb; v_pkg uuid; v_label text; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  v_uid := wms.require(v_o.organization_id, 'packing.execute', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'open_package', p_key, jsonb_build_object('o', p_order));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status <> 'checking' then
    raise exception using errcode = 'WA409', message = 'Pedido não está em conferência.', detail = v_o.status;
  end if;
  v_label := 'VOL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into wms.packages (organization_id, warehouse_id, order_id, label_code, created_by)
  values (v_o.organization_id, v_o.warehouse_id, p_order, v_label, v_uid) returning id into v_pkg;
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'package_opened', 'package', v_pkg::text, jsonb_build_object('label', v_label));
  v_result := jsonb_build_object('package_id', v_pkg, 'label_code', v_label);
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

-- Conferência por leitura: produto, quantidade, lote e série contra o que foi separado.
create or replace function wms.pack_scan(
  p_package uuid, p_scan_id uuid, p_code text, p_quantity numeric,
  p_lot_code text default null, p_serial text default null, p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p wms.packages; v_o wms.orders; v_wh wms.warehouses; v_uid uuid; v_replay jsonb; v_res record; v_prod wms.products;
  v_qty numeric; v_lot uuid; v_serial uuid; v_item record; v_result jsonb;
begin
  select * into v_p from wms.packages where id = p_package;
  if not found then raise exception using errcode = 'WA404', message = 'Volume não encontrado.'; end if;
  v_uid := wms.require(v_p.organization_id, 'packing.execute', v_p.warehouse_id);
  v_replay := wms._idem_begin(v_p.organization_id, 'pack_scan', 'scan:' || p_scan_id::text,
    jsonb_build_object('pkg', p_package, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 's', p_serial, 'p', p_product));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = v_p.order_id for update;
  select * into v_p from wms.packages where id = p_package for update;
  if v_o.status <> 'checking' then
    raise exception using errcode = 'WA409', message = 'Pedido não está em conferência.', detail = v_o.status;
  end if;
  if v_p.status <> 'open' then
    raise exception using errcode = 'WA409', message = 'Volume fechado.', detail = v_p.status;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade deve ser positiva.';
  end if;
  select * into v_res from wms._resolve_one(v_p.organization_id, p_code, p_product);
  select * into v_prod from wms.products where id = v_res.product_id;
  v_qty := p_quantity * v_res.factor;
  v_lot := case when v_prod.lot_control then wms._find_lot(v_prod.id, p_lot_code) end;
  if v_prod.lot_control and v_lot is null then
    raise exception using errcode = 'WA422', message = 'Informe o lote.', detail = 'lot_required';
  end if;
  select * into v_wh from wms.warehouses where id = v_p.warehouse_id;
  if v_prod.serial_control then
    if v_qty <> 1 then raise exception using errcode = 'WA422', message = 'Produto com série: leia uma unidade por vez.'; end if;
    v_serial := wms._find_serial(v_prod.id, p_serial);
    if v_serial is null then raise exception using errcode = 'WA422', message = 'Informe o número de série.', detail = 'serial_required'; end if;
    if not exists (select 1 from wms.serial_numbers where id = v_serial and location_id = v_wh.staging_location_id and lot_id is not distinct from v_lot) then
      raise exception using errcode = 'WA409', message = 'Série não foi separada para expedição.', detail = 'serial_not_staged';
    end if;
    if exists (select 1 from wms.package_items pi join wms.packages pk on pk.id = pi.package_id
                where pi.serial_id = v_serial and pk.status <> 'voided') then
      raise exception using errcode = 'WA409', message = 'Série já embalada.', detail = 'serial_duplicate';
    end if;
  elsif p_serial is not null then
    raise exception using errcode = 'WA422', message = 'Produto não controla série.';
  end if;

  -- Linha do pedido com saldo separado (staged) ainda não embalado para este produto/lote
  select i.id, s.qty - coalesce(pk.qty, 0) as remaining into v_item
    from wms.order_items i
    join (select order_item_id, sum(quantity) as qty from wms.stock_reservations
           where order_id = v_o.id and status = 'staged' and product_id = v_prod.id and lot_id is not distinct from v_lot
           group by order_item_id) s on s.order_item_id = i.id
    left join (select pi.order_item_id, sum(pi.quantity) as qty from wms.package_items pi
                 join wms.packages p2 on p2.id = pi.package_id and p2.status <> 'voided'
                where p2.order_id = v_o.id and pi.product_id = v_prod.id and pi.lot_id is not distinct from v_lot
                group by pi.order_item_id) pk on pk.order_item_id = i.id
   where i.order_id = v_o.id and not i.superseded and s.qty - coalesce(pk.qty, 0) >= v_qty
   order by i.line_no limit 1;
  if v_item.id is null then
    if not exists (select 1 from wms.order_items where order_id = v_o.id and product_id = v_prod.id and not superseded) then
      raise exception using errcode = 'WA409', message = format('Produto %s não pertence ao pedido.', v_prod.sku), detail = 'wrong_product';
    end if;
    raise exception using errcode = 'WA409', message = 'Quantidade/lote acima do separado para o pedido.', detail = 'over_pack';
  end if;

  if v_serial is not null then
    insert into wms.package_items (organization_id, package_id, order_item_id, product_id, lot_id, serial_id, quantity)
    values (v_p.organization_id, p_package, v_item.id, v_prod.id, v_lot, v_serial, 1);
  else
    insert into wms.package_items (organization_id, package_id, order_item_id, product_id, lot_id, quantity)
    values (v_p.organization_id, p_package, v_item.id, v_prod.id, v_lot, v_qty)
    on conflict (package_id, order_item_id, lot_id) where serial_id is null
    do update set quantity = wms.package_items.quantity + excluded.quantity;
  end if;
  insert into wms.scan_events (id, organization_id, warehouse_id, context_type, context_id, user_id, raw_code, product_id, quantity)
  values (p_scan_id, v_p.organization_id, v_p.warehouse_id, 'package', p_package, v_uid, p_code, v_prod.id, v_qty);
  v_result := jsonb_build_object('package_id', p_package, 'product_id', v_prod.id, 'sku', v_prod.sku, 'quantity_base', v_qty,
                                 'unit', v_res.unit_code, 'factor', v_res.factor, 'line_remaining', v_item.remaining - v_qty);
  return wms._idem_finish(v_p.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

create or replace function wms.remove_package_item(p_package_item uuid, p_quantity numeric, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pi wms.package_items; v_p wms.packages;
begin
  select * into v_pi from wms.package_items where id = p_package_item;
  if not found then raise exception using errcode = 'WA404', message = 'Item do volume não encontrado.'; end if;
  select * into v_p from wms.packages where id = v_pi.package_id for update;
  perform wms.require(v_p.organization_id, 'packing.execute', v_p.warehouse_id);
  if v_p.status <> 'open' then
    raise exception using errcode = 'WA409', message = 'Volume fechado.';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > v_pi.quantity then
    raise exception using errcode = 'WA422', message = 'Quantidade inválida.';
  end if;
  if p_quantity = v_pi.quantity then
    delete from wms.package_items where id = p_package_item;
  else
    update wms.package_items set quantity = quantity - p_quantity where id = p_package_item;
  end if;
  perform wms._audit(v_p.organization_id, v_p.warehouse_id, 'package_item_removed', 'package', v_p.id::text,
                     jsonb_build_object('product_id', v_pi.product_id, 'quantity', p_quantity, 'reason', p_reason));
  return jsonb_build_object('package_id', v_p.id, 'removed', p_quantity);
end;
$$;

-- Peso e dimensões são informados pelo operador (sem integração com balança).
create or replace function wms.close_package(p_package uuid, p_weight_kg numeric, p_length numeric, p_width numeric, p_height numeric, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_p wms.packages; v_replay jsonb; v_result jsonb;
begin
  select * into v_p from wms.packages where id = p_package;
  if not found then raise exception using errcode = 'WA404', message = 'Volume não encontrado.'; end if;
  perform wms.require(v_p.organization_id, 'packing.execute', v_p.warehouse_id);
  v_replay := wms._idem_begin(v_p.organization_id, 'close_package', p_key,
                              jsonb_build_object('p', p_package, 'w', p_weight_kg, 'l', p_length, 'wd', p_width, 'h', p_height));
  if v_replay is not null then return v_replay; end if;
  select * into v_p from wms.packages where id = p_package for update;
  if v_p.status <> 'open' then
    raise exception using errcode = 'WA409', message = 'Volume já fechado.';
  end if;
  if not exists (select 1 from wms.package_items where package_id = p_package) then
    raise exception using errcode = 'WA409', message = 'Volume vazio.';
  end if;
  update wms.packages set status = 'closed', closed_at = now(), weight_kg = p_weight_kg,
         length_cm = p_length, width_cm = p_width, height_cm = p_height
   where id = p_package;
  perform wms._audit(v_p.organization_id, v_p.warehouse_id, 'package_closed', 'package', p_package::text,
                     jsonb_build_object('weight_kg', p_weight_kg));
  v_result := jsonb_build_object('package_id', p_package, 'status', 'closed', 'label_code', v_p.label_code);
  return wms._idem_finish(v_p.organization_id, p_key, v_result);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Peso/dimensões inválidos.';
end;
$$;

-- Fecha a conferência: divergência entre separado e embalado bloqueia.
create or replace function wms.complete_packing(p_order uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o wms.orders; v_replay jsonb; v_div jsonb; v_result jsonb;
begin
  select * into v_o from wms.orders where id = p_order;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado.'; end if;
  perform wms.require(v_o.organization_id, 'packing.execute', v_o.warehouse_id);
  v_replay := wms._idem_begin(v_o.organization_id, 'complete_packing', p_key, jsonb_build_object('o', p_order));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order for update;
  if v_o.status <> 'checking' then
    raise exception using errcode = 'WA409', message = 'Pedido não está em conferência.', detail = v_o.status;
  end if;
  if exists (select 1 from wms.packages where order_id = p_order and status = 'open') then
    raise exception using errcode = 'WA409', message = 'Feche todos os volumes antes de concluir.', detail = 'open_packages';
  end if;
  if not exists (select 1 from wms.packages where order_id = p_order and status = 'closed') then
    raise exception using errcode = 'WA409', message = 'Nenhum volume fechado.';
  end if;
  select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'product_id', i.product_id, 'ordered', i.quantity,
                                      'staged', coalesce(s.qty, 0), 'packed', coalesce(pk.qty, 0)))
    into v_div
    from wms.order_items i
    left join (select order_item_id, sum(quantity) qty from wms.stock_reservations where order_id = p_order and status = 'staged' group by 1) s
      on s.order_item_id = i.id
    left join (select pi.order_item_id, sum(pi.quantity) qty from wms.package_items pi
                 join wms.packages p on p.id = pi.package_id and p.status = 'closed' and p.order_id = p_order group by 1) pk
      on pk.order_item_id = i.id
   where i.order_id = p_order and i.kind <> 'kit_parent' and not i.superseded
     and (coalesce(s.qty, 0) <> i.quantity or coalesce(pk.qty, 0) <> i.quantity);
  if v_div is not null then
    raise exception using errcode = 'WA409', message = 'Divergência entre pedido, separado e embalado.', detail = 'packing_divergence', hint = v_div::text;
  end if;
  update wms.packing_checks set status = 'completed', completed_at = now(), version = version + 1 where order_id = p_order;
  perform wms._set_order_status(p_order, 'packed');
  perform wms._audit(v_o.organization_id, v_o.warehouse_id, 'packing_completed', 'order', p_order::text, '{}'::jsonb);
  v_result := jsonb_build_object('order_id', p_order, 'status', 'packed');
  return wms._idem_finish(v_o.organization_id, p_key, v_result);
end;
$$;

-- Impressão/reimpressão de etiqueta interna: só registra (sem nova remessa nem baixa).
create or replace function wms.register_label_print(p_package uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_p wms.packages;
begin
  select * into v_p from wms.packages where id = p_package for update;
  if not found then raise exception using errcode = 'WA404', message = 'Volume não encontrado.'; end if;
  if v_p.label_print_count = 0 then
    perform wms.require(v_p.organization_id, 'packing.execute', v_p.warehouse_id);
  else
    perform wms.require(v_p.organization_id, 'labels.reprint', v_p.warehouse_id);
    if coalesce(trim(p_reason), '') = '' then
      raise exception using errcode = 'WA422', message = 'Informe o motivo da reimpressão.';
    end if;
  end if;
  if v_p.status = 'voided' then
    raise exception using errcode = 'WA409', message = 'Volume anulado.';
  end if;
  update wms.packages set label_print_count = label_print_count + 1 where id = p_package;
  perform wms._audit(v_p.organization_id, v_p.warehouse_id,
                     case when v_p.label_print_count = 0 then 'label_printed' else 'label_reprinted' end,
                     'package', p_package::text, jsonb_build_object('reason', p_reason, 'count', v_p.label_print_count + 1));
  return jsonb_build_object('package_id', p_package, 'label_code', v_p.label_code, 'print_count', v_p.label_print_count + 1);
end;
$$;

-- ---------------------------------------------------------------------
-- Remessa
-- ---------------------------------------------------------------------
create or replace function wms.create_shipment(p_wh uuid, p_carrier text, p_dock_code text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_uid uuid; v_replay jsonb; v_dock wms.locations; v_id uuid; v_code text; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  v_uid := wms.require(v_wh.organization_id, 'shipments.manage', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_shipment', p_key, jsonb_build_object('wh', p_wh, 'c', p_carrier, 'd', p_dock_code));
  if v_replay is not null then return v_replay; end if;
  if p_dock_code is not null then
    v_dock := wms._location_by_code(v_wh.organization_id, p_wh, p_dock_code);
    if v_dock.type <> 'dock' then raise exception using errcode = 'WA422', message = 'Endereço informado não é doca.'; end if;
  end if;
  v_code := 'ROM-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD-') || upper(substr(md5(p_key), 1, 6));
  insert into wms.shipments (organization_id, warehouse_id, code, carrier, dock_location_id, created_by)
  values (v_wh.organization_id, p_wh, v_code, coalesce(p_carrier, ''), v_dock.id, v_uid) returning id into v_id;
  perform wms._audit(v_wh.organization_id, p_wh, 'shipment_created', 'shipment', v_id::text, jsonb_build_object('carrier', p_carrier));
  v_result := jsonb_build_object('shipment_id', v_id, 'code', v_code);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.add_order_to_shipment(p_shipment uuid, p_order uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.shipments; v_o wms.orders; v_replay jsonb; v_n integer; v_result jsonb;
begin
  select * into v_s from wms.shipments where id = p_shipment;
  if not found then raise exception using errcode = 'WA404', message = 'Remessa não encontrada.'; end if;
  perform wms.require(v_s.organization_id, 'shipments.manage', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'add_order_to_shipment', p_key, jsonb_build_object('s', p_shipment, 'o', p_order));
  if v_replay is not null then return v_replay; end if;
  select * into v_o from wms.orders where id = p_order and warehouse_id = v_s.warehouse_id for update;
  if not found then raise exception using errcode = 'WA404', message = 'Pedido não encontrado neste armazém.'; end if;
  select * into v_s from wms.shipments where id = p_shipment for update;
  if v_s.status not in ('open', 'loading') then
    raise exception using errcode = 'WA409', message = 'Remessa não aceita novos pedidos.';
  end if;
  if v_o.status <> 'packed' then
    raise exception using errcode = 'WA409', message = 'Pedido precisa estar embalado.', detail = v_o.status;
  end if;
  insert into wms.shipment_packages (organization_id, shipment_id, package_id, order_id)
  select v_s.organization_id, p_shipment, p.id, p_order from wms.packages p where p.order_id = p_order and p.status = 'closed';
  get diagnostics v_n = row_count;
  perform wms._set_order_status(p_order, 'ready_to_dispatch');
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'shipment_order_added', 'shipment', p_shipment::text,
                     jsonb_build_object('order_id', p_order, 'packages', v_n));
  v_result := jsonb_build_object('shipment_id', p_shipment, 'order_id', p_order, 'packages', v_n);
  return wms._idem_finish(v_s.organization_id, p_key, v_result);
exception when unique_violation then
  raise exception using errcode = 'WA409', message = 'Volume já está em outra remessa.';
end;
$$;

create or replace function wms.remove_order_from_shipment(p_shipment uuid, p_order uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.shipments; v_o wms.orders;
begin
  select * into v_s from wms.shipments where id = p_shipment;
  if not found then raise exception using errcode = 'WA404', message = 'Remessa não encontrada.'; end if;
  perform wms.require(v_s.organization_id, 'shipments.manage', v_s.warehouse_id);
  select * into v_o from wms.orders where id = p_order for update;
  select * into v_s from wms.shipments where id = p_shipment for update;
  if v_s.status not in ('open', 'loading') then
    raise exception using errcode = 'WA409', message = 'Remessa já despachada.';
  end if;
  delete from wms.shipment_packages where shipment_id = p_shipment and order_id = p_order;
  if v_o.status = 'ready_to_dispatch' then
    perform wms._set_order_status(p_order, 'packed');
  end if;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'shipment_order_removed', 'shipment', p_shipment::text, jsonb_build_object('order_id', p_order));
  return jsonb_build_object('shipment_id', p_shipment, 'order_id', p_order, 'removed', true);
end;
$$;

-- Leitura de cada volume no carregamento.
create or replace function wms.load_scan(p_shipment uuid, p_scan_id uuid, p_label text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.shipments; v_uid uuid; v_replay jsonb; v_sp wms.shipment_packages; v_pkg wms.packages; v_result jsonb;
begin
  select * into v_s from wms.shipments where id = p_shipment;
  if not found then raise exception using errcode = 'WA404', message = 'Remessa não encontrada.'; end if;
  v_uid := wms.require(v_s.organization_id, 'shipments.load', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'load_scan', 'scan:' || p_scan_id::text, jsonb_build_object('s', p_shipment, 'l', p_label));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.shipments where id = p_shipment for update;
  if v_s.status not in ('open', 'loading') then
    raise exception using errcode = 'WA409', message = 'Remessa não está em carregamento.';
  end if;
  select * into v_pkg from wms.packages where label_code = upper(trim(p_label)) and organization_id = v_s.organization_id;
  if not found then
    raise exception using errcode = 'WA404', message = 'Etiqueta de volume desconhecida.', detail = 'unknown_package';
  end if;
  select * into v_sp from wms.shipment_packages where shipment_id = p_shipment and package_id = v_pkg.id for update;
  if not found then
    raise exception using errcode = 'WA409', message = 'Volume não pertence a esta remessa.', detail = 'wrong_shipment';
  end if;
  if v_sp.loaded_at is null then
    update wms.shipment_packages set loaded_at = now(), loaded_by = v_uid where shipment_id = p_shipment and package_id = v_pkg.id;
  end if;
  if v_s.status = 'open' then
    update wms.shipments set status = 'loading', version = version + 1 where id = p_shipment;
  end if;
  insert into wms.scan_events (id, organization_id, warehouse_id, context_type, context_id, user_id, raw_code)
  values (p_scan_id, v_s.organization_id, v_s.warehouse_id, 'shipment', p_shipment, v_uid, p_label);
  v_result := jsonb_build_object('shipment_id', p_shipment, 'package_id', v_pkg.id, 'already_loaded', v_sp.loaded_at is not null,
    'pending', (select count(*) from wms.shipment_packages where shipment_id = p_shipment and loaded_at is null));
  return wms._idem_finish(v_s.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

-- Despacho: confirmação explícita da saída física.
create or replace function wms.dispatch_shipment(p_shipment uuid, p_key text, p_expected_version integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s wms.shipments; v_wh wms.warehouses; v_uid uuid; v_replay jsonb; v_o wms.orders; v_order uuid;
  v_mode text; v_mov uuid; pi record; v_bad jsonb; v_orders jsonb := '[]'::jsonb; v_result jsonb; v_consumed numeric; v_staged numeric;
begin
  select * into v_s from wms.shipments where id = p_shipment;
  if not found then raise exception using errcode = 'WA404', message = 'Remessa não encontrada.'; end if;
  v_uid := wms.require(v_s.organization_id, 'shipments.dispatch', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'dispatch_shipment', p_key, jsonb_build_object('s', p_shipment, 'v', p_expected_version));
  if v_replay is not null then return v_replay; end if;

  -- trava pedidos (por id) e depois a remessa
  perform 1 from wms.orders where id in (select order_id from wms.shipment_packages where shipment_id = p_shipment) order by id for update;
  select * into v_s from wms.shipments where id = p_shipment for update;
  if p_expected_version is not null and v_s.version <> p_expected_version then
    raise exception using errcode = 'WA409', message = 'Remessa alterada. Atualize a tela.', detail = 'version_conflict';
  end if;
  if v_s.status = 'dispatched' then
    raise exception using errcode = 'WA409', message = 'Remessa já despachada.', detail = 'already_dispatched';
  end if;
  if v_s.status not in ('open', 'loading') then
    raise exception using errcode = 'WA409', message = 'Remessa não pode ser despachada.', detail = v_s.status;
  end if;
  if not exists (select 1 from wms.shipment_packages where shipment_id = p_shipment) then
    raise exception using errcode = 'WA409', message = 'Remessa sem volumes.';
  end if;
  if exists (select 1 from wms.shipment_packages where shipment_id = p_shipment and loaded_at is null) then
    raise exception using errcode = 'WA409', message = 'Há volumes não conferidos no carregamento.', detail = 'packages_not_loaded';
  end if;
  select * into v_wh from wms.warehouses where id = v_s.warehouse_id;

  select jsonb_agg(jsonb_build_object('order_id', o.id, 'number', o.number, 'status', o.status, 'fiscal_status', o.fiscal_status,
                                      'revision', o.revision, 'allocated_revision', o.allocated_revision))
    into v_bad
    from wms.orders o
   where o.id in (select order_id from wms.shipment_packages where shipment_id = p_shipment)
     and (o.status <> 'ready_to_dispatch'
          or o.revision is distinct from o.allocated_revision
          or (v_wh.require_fiscal_release and o.fiscal_status not in ('released', 'not_required'))
          -- expedição parcial desabilitada: todos os volumes fechados do pedido nesta remessa
          or exists (select 1 from wms.packages p where p.order_id = o.id and p.status = 'closed'
                      and not exists (select 1 from wms.shipment_packages sp where sp.shipment_id = p_shipment and sp.package_id = p.id)));
  if v_bad is not null then
    raise exception using errcode = 'WA409',
      message = 'Pedido(s) não liberado(s) para saída: cancelado, em espera, revisão alterada, liberação fiscal pendente ou volumes faltando.',
      detail = 'dispatch_blocked', hint = v_bad::text;
  end if;

  v_mode := wms._erp_posting_mode(v_s.warehouse_id, 'outbound');
  for v_order in select distinct order_id from wms.shipment_packages where shipment_id = p_shipment order by order_id loop
    select * into v_o from wms.orders where id = v_order;
    v_mov := wms._new_movement(v_s.organization_id, v_s.warehouse_id, 'dispatch', 'Despacho ' || v_o.number || ' / ' || v_s.code,
                               'order', v_order, p_key, v_mode);
    v_consumed := 0;
    for pi in select pk.product_id, pk.lot_id, pk.serial_id, sum(pk.quantity) as qty
                from wms.package_items pk join wms.packages p on p.id = pk.package_id
               where p.order_id = v_order and p.status = 'closed'
               group by pk.product_id, pk.lot_id, pk.serial_id
               order by pk.product_id, pk.lot_id, pk.serial_id loop
      perform wms._post_entry(v_mov, v_s.organization_id, v_s.warehouse_id, v_wh.staging_location_id,
                              pi.product_id, pi.lot_id, pi.serial_id, 'available', -pi.qty, -pi.qty);
      if pi.serial_id is not null then
        update wms.serial_numbers set status = 'dispatched', updated_at = now() where id = pi.serial_id;
      end if;
      v_consumed := v_consumed + pi.qty;
    end loop;
    select coalesce(sum(quantity), 0) into v_staged from wms.stock_reservations where order_id = v_order and status = 'staged';
    if v_staged <> v_consumed then
      raise exception using errcode = 'WA409', message = 'Reserva em staging diverge do embalado.', detail = 'reservation_mismatch';
    end if;
    update wms.stock_reservations set status = 'consumed', updated_at = now() where order_id = v_order and status = 'staged';
    update wms.packages set status = 'dispatched' where order_id = v_order and status = 'closed';
    perform wms._set_order_status(v_order, 'dispatched');
    insert into wms.dispatch_events (organization_id, shipment_id, order_id, movement_id, dispatched_by)
    values (v_s.organization_id, p_shipment, v_order, v_mov, v_uid);
    perform wms._erp_enqueue(v_s.organization_id, v_s.warehouse_id, 'outbound', v_mode, v_mov, 'order', v_order,
                             wms._movement_lines(v_mov, -1) );
    v_orders := v_orders || jsonb_build_object('order_id', v_order, 'movement_id', v_mov, 'erp_posting', v_mode);
  end loop;

  perform wms._assert_transition('shipment', case when v_s.status = 'open' then 'loading' else v_s.status end, 'dispatched');
  update wms.shipments set status = 'dispatched', dispatched_at = now(), dispatched_by = v_uid, version = version + 1 where id = p_shipment;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'shipment_dispatched', 'shipment', p_shipment::text, jsonb_build_object('orders', v_orders));
  v_result := jsonb_build_object('shipment_id', p_shipment, 'status', 'dispatched', 'orders', v_orders, 'erp_posting', v_mode);
  return wms._idem_finish(v_s.organization_id, p_key, v_result);
end;
$$;
