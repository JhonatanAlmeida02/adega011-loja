-- =====================================================================
-- WMS · 05 · Recebimento, armazenagem e movimentações internas
-- A previsão (ERP ou manual) NÃO cria estoque. Só a confirmação do que foi
-- conferido e aceito lança no ledger, em recebimento ou quarentena.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sugestão de endereço: mesmo produto/lote, zona preferida, capacidade.
-- ---------------------------------------------------------------------
create or replace function wms._suggest_location(p_org uuid, p_wh uuid, p_product uuid, p_lot uuid, p_qty numeric)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select l.id
    from wms.locations l
   where l.organization_id = p_org and l.warehouse_id = p_wh and l.status = 'active'
     and not l.blocked and l.counting_session_id is null and l.type in ('storage', 'picking')
     and (l.capacity_units is null
          or l.capacity_units >= coalesce((select sum(b.quantity) from wms.stock_balances b where b.location_id = l.id), 0) + p_qty)
   order by
     exists (select 1 from wms.stock_balances b where b.location_id = l.id and b.product_id = p_product
              and b.lot_id is not distinct from p_lot and b.quantity > 0) desc,
     (l.zone_id is not distinct from (select preferred_zone_id from wms.products where id = p_product)) desc,
     exists (select 1 from wms.stock_balances b where b.location_id = l.id and b.quantity > 0) asc,
     (l.type = 'storage') desc, l.sort_order, l.code
   limit 1;
$$;

create or replace function wms._new_putaway_task(
  p_org uuid, p_wh uuid, p_kind text, p_source_type text, p_source_id uuid, p_product uuid, p_lot uuid, p_serial uuid,
  p_condition text, p_from uuid, p_qty numeric, p_to uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  insert into wms.putaway_tasks (organization_id, warehouse_id, kind, source_type, source_id, product_id, lot_id, serial_id,
                                 condition, from_location_id, suggested_location_id, quantity)
  values (p_org, p_wh, p_kind, p_source_type, p_source_id, p_product, p_lot, p_serial, p_condition, p_from,
          coalesce(p_to, wms._suggest_location(p_org, p_wh, p_product, p_lot, p_qty)), p_qty)
  returning id into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Recebimento
-- ---------------------------------------------------------------------
-- Previsão manual autorizada (quando não há recurso de ERP validado), com auditoria.
create or replace function wms.create_manual_receipt(
  p_wh uuid, p_source_ref text, p_supplier text, p_items jsonb, p_quarantine boolean, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses;
  v_replay jsonb;
  v_receipt uuid;
  v_line integer := 0;
  i record;
  v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'receipts.create', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_manual_receipt', p_key,
    jsonb_build_object('wh', p_wh, 'ref', p_source_ref, 'supplier', p_supplier, 'items', p_items, 'q', p_quarantine));
  if v_replay is not null then return v_replay; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'WA422', message = 'Informe ao menos um item.';
  end if;
  if exists (select 1 from wms.receipts where organization_id = v_wh.organization_id and source_type = 'manual' and source_ref = trim(p_source_ref)) then
    raise exception using errcode = 'WA409', message = format('Já existe recebimento para o documento %s.', p_source_ref), detail = 'duplicate_source';
  end if;
  insert into wms.receipts (organization_id, warehouse_id, source_type, source_ref, supplier_name, quarantine_on_receipt, created_by)
  values (v_wh.organization_id, p_wh, 'manual', trim(p_source_ref), coalesce(p_supplier, ''), coalesce(p_quarantine, false), auth.uid())
  returning id into v_receipt;
  for i in select (x->>'product_id')::uuid as product_id, (x->>'quantity')::numeric as quantity
             from jsonb_array_elements(p_items) x loop
    v_line := v_line + 1;
    if not exists (select 1 from wms.products where id = i.product_id and organization_id = v_wh.organization_id and status = 'active') then
      raise exception using errcode = 'WA422', message = 'Produto inválido na previsão.';
    end if;
    if i.quantity is null or i.quantity <= 0 then
      raise exception using errcode = 'WA422', message = 'Quantidade prevista deve ser positiva.';
    end if;
    insert into wms.receipt_items (organization_id, receipt_id, line_no, product_id, expected_qty)
    values (v_wh.organization_id, v_receipt, v_line, i.product_id, i.quantity);
  end loop;
  perform wms._audit(v_wh.organization_id, p_wh, 'receipt_created_manual', 'receipt', v_receipt::text,
                     jsonb_build_object('source_ref', p_source_ref, 'items', p_items));
  v_result := jsonb_build_object('receipt_id', v_receipt, 'status', 'expected');
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- Leitura na conferência. Não cria estoque; cada leitura tem ID próprio (retentativa reutiliza).
create or replace function wms.receipt_scan(
  p_receipt uuid, p_scan_id uuid, p_code text, p_quantity numeric, p_lot_code text default null,
  p_expiry date default null, p_serial text default null, p_outcome text default 'accepted', p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r wms.receipts;
  v_replay jsonb;
  v_res record;
  v_prod wms.products;
  v_item wms.receipt_items;
  v_qty numeric;
  v_result jsonb;
begin
  select * into v_r from wms.receipts where id = p_receipt;
  if not found then raise exception using errcode = 'WA404', message = 'Recebimento não encontrado.'; end if;
  perform wms.require(v_r.organization_id, 'receipts.check', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'receipt_scan', 'scan:' || p_scan_id::text,
    jsonb_build_object('r', p_receipt, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 'exp', p_expiry,
                       'serial', p_serial, 'outcome', p_outcome, 'p', p_product));
  if v_replay is not null then return v_replay; end if;

  select * into v_r from wms.receipts where id = p_receipt for update;
  if v_r.status not in ('expected', 'receiving', 'partially_received', 'awaiting_review') then
    raise exception using errcode = 'WA409', message = 'Recebimento não aceita novas leituras neste estado.', detail = v_r.status;
  end if;
  if p_outcome not in ('accepted', 'damaged', 'rejected') then
    raise exception using errcode = 'WA422', message = 'Resultado da conferência inválido.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade deve ser positiva.';
  end if;

  select * into v_res from wms._resolve_one(v_r.organization_id, p_code, p_product);
  select * into v_prod from wms.products where id = v_res.product_id;
  v_qty := p_quantity * v_res.factor;
  if v_qty <> trunc(v_qty) and v_prod.base_unit = 'UN' then
    raise exception using errcode = 'WA422', message = 'Quantidade em unidade base deve ser inteira.';
  end if;

  select * into v_item from wms.receipt_items
   where receipt_id = p_receipt and product_id = v_res.product_id
   order by (status = 'open') desc, line_no limit 1;
  if not found then
    raise exception using errcode = 'WA409', message = format('Produto %s não consta na previsão. Registre a sobra com o supervisor.', v_prod.sku), detail = 'unexpected_product';
  end if;

  if v_prod.serial_control then
    if v_qty <> 1 then
      raise exception using errcode = 'WA422', message = 'Produto com série: leia uma unidade por vez.', detail = 'serial_qty';
    end if;
    if p_serial is null then
      raise exception using errcode = 'WA422', message = 'Informe o número de série.', detail = 'serial_required';
    end if;
    if exists (select 1 from wms.serial_numbers where product_id = v_prod.id and serial = trim(p_serial) and location_id is not null) then
      raise exception using errcode = 'WA409', message = format('Série duplicada: %s já está em estoque.', p_serial), detail = 'serial_duplicate';
    end if;
    if exists (select 1 from wms.receipt_checks where receipt_id = p_receipt and product_id = v_prod.id and serial = trim(p_serial)) then
      raise exception using errcode = 'WA409', message = format('Série %s já conferida neste recebimento.', p_serial), detail = 'serial_duplicate';
    end if;
  elsif p_serial is not null then
    raise exception using errcode = 'WA422', message = 'Produto não controla série.';
  end if;
  if v_prod.lot_control and p_outcome <> 'rejected' then
    perform wms._ensure_lot(v_r.organization_id, v_prod.id, p_lot_code, p_expiry);
  elsif not v_prod.lot_control and p_lot_code is not null then
    raise exception using errcode = 'WA422', message = 'Produto não controla lote.';
  end if;

  if v_r.status in ('expected', 'partially_received', 'awaiting_review') then
    perform wms._assert_transition('receipt', v_r.status, 'receiving');
    update wms.receipts set status = 'receiving', started_at = coalesce(started_at, now()), version = version + 1 where id = p_receipt;
  end if;

  insert into wms.receipt_checks (id, organization_id, receipt_id, receipt_item_id, product_id, unit_code, unit_factor,
                                  quantity, lot_code, expiry_date, serial, outcome, created_by)
  values (p_scan_id, v_r.organization_id, p_receipt, v_item.id, v_prod.id, v_res.unit_code, v_res.factor,
          v_qty, nullif(trim(p_lot_code), ''), p_expiry, nullif(trim(p_serial), ''), p_outcome, auth.uid());
  insert into wms.scan_events (id, organization_id, warehouse_id, context_type, context_id, user_id, raw_code, product_id, quantity)
  values (p_scan_id, v_r.organization_id, v_r.warehouse_id, 'receipt', p_receipt, auth.uid(), p_code, v_prod.id, v_qty);

  v_result := jsonb_build_object(
    'check_id', p_scan_id, 'product_id', v_prod.id, 'sku', v_prod.sku, 'description', v_prod.description,
    'unit', v_res.unit_code, 'factor', v_res.factor, 'quantity_base', v_qty, 'outcome', p_outcome,
    'item', jsonb_build_object('line_no', v_item.line_no, 'expected', v_item.expected_qty, 'received', v_item.received_qty,
      'checked_pending', (select coalesce(sum(quantity), 0) from wms.receipt_checks
                           where receipt_item_id = v_item.id and movement_id is null and outcome <> 'rejected')));
  return wms._idem_finish(v_r.organization_id, 'scan:' || p_scan_id::text, v_result);
end;
$$;

-- Confirma o que foi conferido. Sobra exige aprovação do supervisor antes de lançar.
create or replace function wms.confirm_receipt(p_receipt uuid, p_key text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r wms.receipts;
  v_wh wms.warehouses;
  v_replay jsonb;
  v_mov uuid;
  c record;
  it record;
  v_overages jsonb := '[]'::jsonb;
  v_lot uuid;
  v_serial uuid;
  v_loc uuid;
  v_cond text;
  v_status text;
  v_tasks integer := 0;
  v_posting text;
  v_result jsonb;
begin
  select * into v_r from wms.receipts where id = p_receipt;
  if not found then raise exception using errcode = 'WA404', message = 'Recebimento não encontrado.'; end if;
  perform wms.require(v_r.organization_id, 'receipts.confirm', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'confirm_receipt', p_key, jsonb_build_object('r', p_receipt, 'v', p_expected_version));
  if v_replay is not null then return v_replay; end if;

  select * into v_r from wms.receipts where id = p_receipt for update;
  if p_expected_version is not null and v_r.version <> p_expected_version then
    raise exception using errcode = 'WA409', message = 'Recebimento alterado por outro usuário. Atualize a tela.', detail = 'version_conflict';
  end if;
  if v_r.status not in ('receiving', 'awaiting_review') then
    raise exception using errcode = 'WA409', message = 'Recebimento não está em conferência.', detail = v_r.status;
  end if;
  if not exists (select 1 from wms.receipt_checks where receipt_id = p_receipt and movement_id is null) then
    raise exception using errcode = 'WA409', message = 'Nada conferido para confirmar.', detail = 'nothing_to_confirm';
  end if;
  select * into v_wh from wms.warehouses where id = v_r.warehouse_id;
  if v_wh.receiving_location_id is null or v_wh.quarantine_location_id is null then
    raise exception using errcode = 'WA409', message = 'Armazém sem endereço padrão de recebimento/quarentena.';
  end if;

  -- Sobra: aceito + avariado acima do previsto (+ sobra aprovada) bloqueia a confirmação.
  for it in
    select i.id, i.line_no, i.product_id, i.expected_qty, i.overage_approved_qty,
           i.received_qty + i.damaged_qty + coalesce(sum(c2.quantity) filter (where c2.outcome <> 'rejected'), 0) as total_after
      from wms.receipt_items i
      left join wms.receipt_checks c2 on c2.receipt_item_id = i.id and c2.movement_id is null
     where i.receipt_id = p_receipt
     group by i.id
  loop
    if it.total_after > it.expected_qty + it.overage_approved_qty then
      v_overages := v_overages || jsonb_build_object('line_no', it.line_no, 'product_id', it.product_id,
                                                      'expected', it.expected_qty, 'received', it.total_after);
      if not exists (select 1 from wms.discrepancies where entity_type = 'receipt_item' and entity_id = it.id
                      and kind = 'receipt_overage' and status = 'open') then
        perform wms._discrepancy(v_r.organization_id, v_r.warehouse_id, 'receipt_overage', 'receipt_item', it.id,
                                 it.product_id, null, it.total_after - it.expected_qty - it.overage_approved_qty,
                                 jsonb_build_object('receipt_id', p_receipt, 'line_no', it.line_no));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_overages) > 0 then
    perform wms._assert_transition('receipt', v_r.status, 'awaiting_review');
    update wms.receipts set status = 'awaiting_review', version = version + 1 where id = p_receipt;
    perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_overage_review', 'receipt', p_receipt::text,
                       jsonb_build_object('overages', v_overages));
    v_result := jsonb_build_object('receipt_id', p_receipt, 'status', 'awaiting_review', 'overages', v_overages, 'posted', false);
    return wms._idem_finish(v_r.organization_id, p_key, v_result);
  end if;

  v_posting := case when exists (select 1 from wms.receipt_checks where receipt_id = p_receipt and movement_id is null and outcome <> 'rejected')
                    then wms._erp_posting_mode(v_r.warehouse_id, 'inbound') else 'none' end;
  v_mov := wms._new_movement(v_r.organization_id, v_r.warehouse_id, 'receipt', 'Recebimento ' || v_r.source_ref,
                             'receipt', p_receipt, p_key, v_posting);
  for c in select * from wms.receipt_checks where receipt_id = p_receipt and movement_id is null
            order by product_id, lot_code nulls first, serial nulls first, created_at
  loop
    if c.outcome <> 'rejected' then
      v_lot := wms._ensure_lot(v_r.organization_id, c.product_id, c.lot_code, c.expiry_date);
      v_serial := case when c.serial is not null then wms._ensure_serial(v_r.organization_id, c.product_id, c.serial, v_lot) end;
      if c.outcome = 'damaged' then
        v_loc := v_wh.quarantine_location_id; v_cond := 'damaged';
      elsif v_r.quarantine_on_receipt then
        v_loc := v_wh.quarantine_location_id; v_cond := 'quarantine';
      else
        v_loc := v_wh.receiving_location_id; v_cond := 'available';
      end if;
      perform wms._post_entry(v_mov, v_r.organization_id, v_r.warehouse_id, v_loc, c.product_id, v_lot, v_serial, v_cond, c.quantity);
    end if;
    update wms.receipt_checks set movement_id = v_mov where id = c.id;
  end loop;

  -- Tarefas de armazenagem para o que entrou disponível (agrupado por produto/lote; série uma a uma)
  for it in select e.product_id, e.lot_id, e.serial_id, sum(e.quantity) as qty
              from wms.stock_entries e
             where e.movement_id = v_mov and e.condition = 'available'
             group by e.product_id, e.lot_id, e.serial_id
             order by e.product_id loop
    perform wms._new_putaway_task(v_r.organization_id, v_r.warehouse_id, 'putaway', 'receipt', p_receipt,
                                  it.product_id, it.lot_id, it.serial_id, 'available', v_wh.receiving_location_id, it.qty);
    v_tasks := v_tasks + 1;
  end loop;

  update wms.receipt_items i set
    received_qty = i.received_qty + coalesce((select sum(quantity) from wms.receipt_checks rc where rc.receipt_item_id = i.id and rc.movement_id = v_mov and rc.outcome = 'accepted'), 0),
    damaged_qty = i.damaged_qty + coalesce((select sum(quantity) from wms.receipt_checks rc where rc.receipt_item_id = i.id and rc.movement_id = v_mov and rc.outcome = 'damaged'), 0),
    rejected_qty = i.rejected_qty + coalesce((select sum(quantity) from wms.receipt_checks rc where rc.receipt_item_id = i.id and rc.movement_id = v_mov and rc.outcome = 'rejected'), 0)
   where i.receipt_id = p_receipt;
  update wms.receipt_items set status = 'complete' where receipt_id = p_receipt and received_qty >= expected_qty and status = 'open';

  for it in select i.id, i.product_id,
                   coalesce(sum(rc.quantity) filter (where rc.outcome = 'damaged'), 0) as damaged,
                   coalesce(sum(rc.quantity) filter (where rc.outcome = 'rejected'), 0) as rejected
              from wms.receipt_items i join wms.receipt_checks rc on rc.receipt_item_id = i.id and rc.movement_id = v_mov
             where i.receipt_id = p_receipt group by i.id loop
    if it.damaged > 0 then
      perform wms._discrepancy(v_r.organization_id, v_r.warehouse_id, 'receipt_damaged', 'receipt_item', it.id, it.product_id,
                               v_wh.quarantine_location_id, it.damaged, jsonb_build_object('receipt_id', p_receipt));
    end if;
    if it.rejected > 0 then
      perform wms._discrepancy(v_r.organization_id, v_r.warehouse_id, 'receipt_rejected', 'receipt_item', it.id, it.product_id,
                               null, it.rejected, jsonb_build_object('receipt_id', p_receipt));
    end if;
  end loop;

  v_status := case when not exists (select 1 from wms.receipt_items where receipt_id = p_receipt and status = 'open')
                   then 'received' else 'partially_received' end;
  perform wms._assert_transition('receipt', v_r.status, v_status);

  perform wms._erp_enqueue(v_r.organization_id, v_r.warehouse_id, 'inbound', v_posting, v_mov, 'receipt', p_receipt,
                          wms._movement_lines(v_mov, 1));

  update wms.receipts set status = v_status, version = version + 1,
         closed_at = case when v_status = 'received' then now() end
   where id = p_receipt;
  perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_confirmed', 'receipt', p_receipt::text,
                     jsonb_build_object('movement_id', v_mov, 'status', v_status, 'erp_posting', v_posting));
  v_result := jsonb_build_object('receipt_id', p_receipt, 'status', v_status, 'movement_id', v_mov, 'posted', true,
                                 'putaway_tasks', v_tasks, 'erp_posting', v_posting);
  return wms._idem_finish(v_r.organization_id, p_key, v_result);
end;
$$;

-- Supervisor trata sobra: aprova quantidade extra para a linha (ou recusa e o conferente refaz a leitura).
create or replace function wms.review_receipt_overage(p_receipt_item uuid, p_approved_qty numeric, p_note text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_item wms.receipt_items; v_r wms.receipts; v_uid uuid; v_replay jsonb; v_result jsonb;
begin
  select * into v_item from wms.receipt_items where id = p_receipt_item;
  if not found then raise exception using errcode = 'WA404', message = 'Item não encontrado.'; end if;
  select * into v_r from wms.receipts where id = v_item.receipt_id;
  v_uid := wms.require(v_r.organization_id, 'receipts.review', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'review_receipt_overage', p_key,
                              jsonb_build_object('i', p_receipt_item, 'q', p_approved_qty, 'n', p_note));
  if v_replay is not null then return v_replay; end if;
  if p_approved_qty is null or p_approved_qty < 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade aprovada inválida.';
  end if;
  perform 1 from wms.receipts where id = v_r.id for update;
  update wms.receipt_items set overage_approved_qty = p_approved_qty where id = p_receipt_item;
  update wms.discrepancies set status = 'resolved', resolved_by = v_uid, resolved_at = now(),
         resolution = format('Sobra aprovada: %s. %s', p_approved_qty, coalesce(p_note, ''))
   where entity_type = 'receipt_item' and entity_id = p_receipt_item and kind = 'receipt_overage' and status = 'open';
  insert into wms.approvals (organization_id, warehouse_id, kind, entity_type, entity_id, decided_by, decision, notes)
  values (v_r.organization_id, v_r.warehouse_id, 'receipt_overage', 'receipt_item', p_receipt_item, v_uid, 'approved', coalesce(p_note, ''));
  if v_r.status = 'awaiting_review' then
    update wms.receipts set status = 'receiving', version = version + 1 where id = v_r.id;
  end if;
  perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_overage_approved', 'receipt_item', p_receipt_item::text,
                     jsonb_build_object('approved_qty', p_approved_qty, 'note', p_note));
  v_result := jsonb_build_object('receipt_item_id', p_receipt_item, 'overage_approved_qty', p_approved_qty);
  return wms._idem_finish(v_r.organization_id, p_key, v_result);
end;
$$;

-- Remove leitura ainda não confirmada (ex.: sobra recusada). Auditado.
create or replace function wms.void_receipt_check(p_check uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c wms.receipt_checks; v_r wms.receipts;
begin
  select * into v_c from wms.receipt_checks where id = p_check;
  if not found then raise exception using errcode = 'WA404', message = 'Leitura não encontrada.'; end if;
  select * into v_r from wms.receipts where id = v_c.receipt_id for update;
  perform wms.require(v_r.organization_id, 'receipts.review', v_r.warehouse_id);
  if v_c.movement_id is not null then
    raise exception using errcode = 'WA409', message = 'Leitura já confirmada não pode ser removida.';
  end if;
  delete from wms.receipt_checks where id = p_check;
  perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_check_voided', 'receipt_check', p_check::text,
                     jsonb_build_object('reason', p_reason, 'quantity', v_c.quantity, 'product_id', v_c.product_id));
  return jsonb_build_object('check_id', p_check, 'voided', true);
end;
$$;

-- Encerra recebimento parcial: o saldo pendente vira ocorrência de falta.
create or replace function wms.close_receipt_short(p_receipt uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r wms.receipts; v_uid uuid; v_replay jsonb; it record; v_result jsonb;
begin
  select * into v_r from wms.receipts where id = p_receipt;
  if not found then raise exception using errcode = 'WA404', message = 'Recebimento não encontrado.'; end if;
  v_uid := wms.require(v_r.organization_id, 'receipts.review', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'close_receipt_short', p_key, jsonb_build_object('r', p_receipt, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  select * into v_r from wms.receipts where id = p_receipt for update;
  if v_r.status not in ('partially_received', 'receiving') then
    raise exception using errcode = 'WA409', message = 'Somente recebimento parcial pode ser encerrado com falta.';
  end if;
  if exists (select 1 from wms.receipt_checks where receipt_id = p_receipt and movement_id is null) then
    raise exception using errcode = 'WA409', message = 'Há leituras não confirmadas: confirme ou remova antes de encerrar.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo do encerramento com falta.';
  end if;
  for it in select * from wms.receipt_items where receipt_id = p_receipt and status = 'open' loop
    perform wms._discrepancy(v_r.organization_id, v_r.warehouse_id, 'receipt_short', 'receipt_item', it.id, it.product_id,
                             null, it.expected_qty - it.received_qty, jsonb_build_object('receipt_id', p_receipt, 'reason', p_reason));
  end loop;
  update wms.receipt_items set status = 'closed_short' where receipt_id = p_receipt and status = 'open';
  perform wms._assert_transition('receipt', v_r.status, 'received');
  update wms.receipts set status = 'received', closed_at = now(), version = version + 1 where id = p_receipt;
  perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_closed_short', 'receipt', p_receipt::text, jsonb_build_object('reason', p_reason));
  v_result := jsonb_build_object('receipt_id', p_receipt, 'status', 'received');
  return wms._idem_finish(v_r.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.cancel_receipt(p_receipt uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r wms.receipts; v_replay jsonb; v_result jsonb;
begin
  select * into v_r from wms.receipts where id = p_receipt;
  if not found then raise exception using errcode = 'WA404', message = 'Recebimento não encontrado.'; end if;
  perform wms.require(v_r.organization_id, 'receipts.review', v_r.warehouse_id);
  v_replay := wms._idem_begin(v_r.organization_id, 'cancel_receipt', p_key, jsonb_build_object('r', p_receipt, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  select * into v_r from wms.receipts where id = p_receipt for update;
  if exists (select 1 from wms.receipt_checks where receipt_id = p_receipt and movement_id is not null) then
    raise exception using errcode = 'WA409', message = 'Recebimento com estoque lançado não pode ser cancelado.';
  end if;
  perform wms._assert_transition('receipt', v_r.status, 'cancelled');
  delete from wms.receipt_checks where receipt_id = p_receipt;
  update wms.receipts set status = 'cancelled', closed_at = now(), version = version + 1 where id = p_receipt;
  perform wms._audit(v_r.organization_id, v_r.warehouse_id, 'receipt_cancelled', 'receipt', p_receipt::text, jsonb_build_object('reason', p_reason));
  v_result := jsonb_build_object('receipt_id', p_receipt, 'status', 'cancelled');
  return wms._idem_finish(v_r.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Armazenagem / reabastecimento / retorno ao estoque
-- O operador confirma origem, produto e destino por leitura.
-- ---------------------------------------------------------------------
create or replace function wms.confirm_putaway(p_task uuid, p_from_code text, p_code text, p_to_code text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t wms.putaway_tasks;
  v_uid uuid;
  v_replay jsonb;
  v_from wms.locations;
  v_to wms.locations;
  v_res record;
  v_mov uuid;
  v_result jsonb;
begin
  select * into v_t from wms.putaway_tasks where id = p_task;
  if not found then raise exception using errcode = 'WA404', message = 'Tarefa não encontrada.'; end if;
  v_uid := wms.require(v_t.organization_id, 'stock.putaway', v_t.warehouse_id);
  v_replay := wms._idem_begin(v_t.organization_id, 'confirm_putaway', p_key,
                              jsonb_build_object('t', p_task, 'from', p_from_code, 'code', p_code, 'to', p_to_code));
  if v_replay is not null then return v_replay; end if;
  select * into v_t from wms.putaway_tasks where id = p_task for update;
  if v_t.status <> 'open' then
    raise exception using errcode = 'WA409', message = 'Tarefa já encerrada.', detail = v_t.status;
  end if;
  v_from := wms._location_by_code(v_t.organization_id, v_t.warehouse_id, p_from_code);
  if v_from.id <> v_t.from_location_id then
    raise exception using errcode = 'WA409', message = 'Endereço de origem lido não é o da tarefa.', detail = 'wrong_location';
  end if;
  select * into v_res from wms._resolve_one(v_t.organization_id, p_code, v_t.product_id);
  if v_res.factor <> 1 and v_t.quantity % v_res.factor <> 0 then
    raise exception using errcode = 'WA422', message = 'Leia o código da unidade base para esta tarefa.';
  end if;
  v_to := wms._location_by_code(v_t.organization_id, v_t.warehouse_id, p_to_code);
  if v_to.type not in ('storage', 'picking') then
    raise exception using errcode = 'WA422', message = 'Destino deve ser endereço de armazenagem ou separação.';
  end if;
  if v_to.id = v_from.id then
    raise exception using errcode = 'WA422', message = 'Destino igual à origem.';
  end if;
  perform wms._lock_balances(v_t.product_id, array[v_from.id, v_to.id]);
  v_mov := wms._new_movement(v_t.organization_id, v_t.warehouse_id,
                             case when v_t.kind = 'replenishment' then 'replenishment' else 'putaway' end,
                             v_t.kind, 'putaway_task', p_task, p_key);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.warehouse_id, v_from.id, v_t.product_id, v_t.lot_id, v_t.serial_id, v_t.condition, -v_t.quantity);
  perform wms._post_entry(v_mov, v_t.organization_id, v_t.warehouse_id, v_to.id, v_t.product_id, v_t.lot_id, v_t.serial_id, v_t.condition, v_t.quantity);
  update wms.putaway_tasks set status = 'completed', to_location_id = v_to.id, completed_at = now(), completed_by = v_uid,
         movement_id = v_mov, version = version + 1
   where id = p_task;
  perform wms._audit(v_t.organization_id, v_t.warehouse_id, 'putaway_confirmed', 'putaway_task', p_task::text,
                     jsonb_build_object('to', v_to.code, 'suggested', v_t.suggested_location_id, 'movement_id', v_mov));
  v_result := jsonb_build_object('task_id', p_task, 'status', 'completed', 'to_location', v_to.code, 'movement_id', v_mov);
  return wms._idem_finish(v_t.organization_id, p_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------
-- Transferência entre endereços do mesmo armazém (só saldo livre; total preservado)
-- ---------------------------------------------------------------------
create or replace function wms.transfer_stock(
  p_wh uuid, p_from_code text, p_to_code text, p_code text, p_quantity numeric,
  p_lot_code text default null, p_serial text default null, p_product uuid default null,
  p_reason text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses;
  v_replay jsonb;
  v_from wms.locations;
  v_to wms.locations;
  v_res record;
  v_lot uuid;
  v_serial uuid;
  v_qty numeric;
  v_mov uuid;
  v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'stock.move', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'transfer_stock', p_key,
    jsonb_build_object('wh', p_wh, 'from', p_from_code, 'to', p_to_code, 'code', p_code, 'q', p_quantity,
                       'lot', p_lot_code, 'serial', p_serial, 'p', p_product, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade deve ser positiva.';
  end if;
  v_from := wms._location_by_code(v_wh.organization_id, p_wh, p_from_code);
  v_to := wms._location_by_code(v_wh.organization_id, p_wh, p_to_code);
  if v_from.id = v_to.id then
    raise exception using errcode = 'WA422', message = 'Origem e destino iguais.';
  end if;
  if v_to.type in ('transit', 'dock') or v_from.type in ('transit', 'dock') then
    raise exception using errcode = 'WA422', message = 'Use o fluxo específico para trânsito/doca.';
  end if;
  select * into v_res from wms._resolve_one(v_wh.organization_id, p_code, p_product);
  v_qty := p_quantity * v_res.factor;
  v_lot := wms._find_lot(v_res.product_id, p_lot_code);
  v_serial := wms._find_serial(v_res.product_id, p_serial);
  perform wms._lock_balances(v_res.product_id, array[v_from.id, v_to.id]);
  v_mov := wms._new_movement(v_wh.organization_id, p_wh, 'transfer', p_reason, 'location', v_from.id, p_key);
  perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_from.id, v_res.product_id, v_lot, v_serial, 'available', -v_qty);
  perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_to.id, v_res.product_id, v_lot, v_serial, 'available', v_qty);
  perform wms._audit(v_wh.organization_id, p_wh, 'stock_transferred', 'stock_movement', v_mov::text,
    jsonb_build_object('from', v_from.code, 'to', v_to.code, 'product_id', v_res.product_id, 'quantity', v_qty, 'unit', v_res.unit_code));
  v_result := jsonb_build_object('movement_id', v_mov, 'product_id', v_res.product_id, 'quantity_base', v_qty,
                                 'unit', v_res.unit_code, 'factor', v_res.factor);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- Bloqueio/liberação de estoque (condição) na mesma posição.
create or replace function wms.change_stock_condition(
  p_wh uuid, p_location_code text, p_product uuid, p_lot_code text, p_serial text,
  p_from text, p_to text, p_quantity numeric, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_wh wms.warehouses; v_replay jsonb; v_loc wms.locations; v_lot uuid; v_serial uuid; v_mov uuid; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'stock.block', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'change_stock_condition', p_key,
    jsonb_build_object('wh', p_wh, 'loc', p_location_code, 'p', p_product, 'lot', p_lot_code, 's', p_serial,
                       'from', p_from, 'to', p_to, 'q', p_quantity, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  if p_from = p_to or p_from = 'in_transit' or p_to = 'in_transit' then
    raise exception using errcode = 'WA422', message = 'Mudança de condição inválida.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo.';
  end if;
  if not exists (select 1 from wms.products where id = p_product and organization_id = v_wh.organization_id) then
    raise exception using errcode = 'WA422', message = 'Produto inválido.';
  end if;
  v_loc := wms._location_by_code(v_wh.organization_id, p_wh, p_location_code);
  v_lot := wms._find_lot(p_product, p_lot_code);
  v_serial := wms._find_serial(p_product, p_serial);
  v_mov := wms._new_movement(v_wh.organization_id, p_wh, 'condition_change', p_reason, 'location', v_loc.id, p_key);
  perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_loc.id, p_product, v_lot, v_serial, p_from, -p_quantity);
  perform wms._post_entry(v_mov, v_wh.organization_id, p_wh, v_loc.id, p_product, v_lot, v_serial, p_to, p_quantity);
  perform wms._audit(v_wh.organization_id, p_wh, 'stock_condition_changed', 'stock_movement', v_mov::text,
    jsonb_build_object('location', v_loc.code, 'from', p_from, 'to', p_to, 'quantity', p_quantity, 'reason', p_reason));
  v_result := jsonb_build_object('movement_id', v_mov);
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
end;
$$;

-- Correção por movimento inverso vinculado (movimentos confirmados nunca são editados).
create or replace function wms.reverse_movement(p_movement uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_m wms.stock_movements; v_replay jsonb; v_new uuid; e record; v_result jsonb;
begin
  select * into v_m from wms.stock_movements where id = p_movement;
  if not found then raise exception using errcode = 'WA404', message = 'Movimento não encontrado.'; end if;
  perform wms.require(v_m.organization_id, 'discrepancies.resolve', v_m.warehouse_id);
  v_replay := wms._idem_begin(v_m.organization_id, 'reverse_movement', p_key, jsonb_build_object('m', p_movement, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  if v_m.movement_type not in ('transfer', 'putaway', 'replenishment', 'condition_change') then
    raise exception using errcode = 'WA409', message = 'Este tipo de movimento tem fluxo próprio de reversão (devolução, inventário ou cancelamento).';
  end if;
  if exists (select 1 from wms.stock_movements where reverses_movement_id = p_movement) then
    raise exception using errcode = 'WA409', message = 'Movimento já revertido.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo da reversão.';
  end if;
  v_new := wms._new_movement(v_m.organization_id, v_m.warehouse_id, 'reversal', p_reason, 'stock_movement', p_movement, p_key, 'none', p_movement);
  -- Primeiro as saídas (as entradas do original), depois as entradas.
  for e in select * from wms.stock_entries where movement_id = p_movement order by quantity desc, id loop
    perform wms._post_entry(v_new, e.organization_id, e.warehouse_id, e.location_id, e.product_id, e.lot_id, e.serial_id, e.condition, -e.quantity);
  end loop;
  perform wms._audit(v_m.organization_id, v_m.warehouse_id, 'movement_reversed', 'stock_movement', p_movement::text,
                     jsonb_build_object('reversal_id', v_new, 'reason', p_reason));
  v_result := jsonb_build_object('movement_id', v_new, 'reverses', p_movement);
  return wms._idem_finish(v_m.organization_id, p_key, v_result);
end;
$$;
