-- =====================================================================
-- WMS · 08 · Inventário (contagem cega, recontagem, aprovação distinta)
-- Também é o caminho da CARGA INICIAL por endereço (kind = 'initial_load'):
-- importar o total do ERP não autoriza distribuir saldo entre endereços.
-- Primeiro lançamento: endereços em contagem ficam bloqueados para
-- movimentação e reserva (sem snapshot com compensação).
-- =====================================================================

create or replace function wms.create_inventory_session(
  p_wh uuid, p_kind text, p_location_codes text[], p_tolerance_qty numeric, p_tolerance_pct numeric,
  p_max_rounds integer, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_replay jsonb; v_id uuid; v_code text; v_loc wms.locations; v_c text; v_result jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'inventory.manage', p_wh);
  v_replay := wms._idem_begin(v_wh.organization_id, 'create_inventory_session', p_key,
    jsonb_build_object('wh', p_wh, 'k', p_kind, 'l', p_location_codes, 'tq', p_tolerance_qty, 'tp', p_tolerance_pct, 'r', p_max_rounds));
  if v_replay is not null then return v_replay; end if;
  if p_location_codes is null or cardinality(p_location_codes) = 0 then
    raise exception using errcode = 'WA422', message = 'Selecione os endereços a contar.';
  end if;
  v_code := 'INV-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD-') || upper(substr(md5(p_key), 1, 6));
  insert into wms.inventory_sessions (organization_id, warehouse_id, code, kind, tolerance_qty, tolerance_pct, max_rounds, created_by)
  values (v_wh.organization_id, p_wh, v_code, coalesce(p_kind, 'cycle'), coalesce(p_tolerance_qty, 0), coalesce(p_tolerance_pct, 0),
          coalesce(p_max_rounds, 2), auth.uid())
  returning id into v_id;
  foreach v_c in array p_location_codes loop
    v_loc := wms._location_by_code(v_wh.organization_id, p_wh, v_c);
    if v_loc.type not in ('storage', 'picking', 'receiving') then
      raise exception using errcode = 'WA422', message = format('Endereço %s não pode ser inventariado por este fluxo.', v_loc.code);
    end if;
    insert into wms.inventory_session_locations (organization_id, session_id, location_id)
    values (v_wh.organization_id, v_id, v_loc.id) on conflict do nothing;
  end loop;
  perform wms._audit(v_wh.organization_id, p_wh, 'inventory_created', 'inventory_session', v_id::text,
                     jsonb_build_object('kind', p_kind, 'locations', p_location_codes));
  v_result := jsonb_build_object('session_id', v_id, 'code', v_code, 'status', 'draft');
  return wms._idem_finish(v_wh.organization_id, p_key, v_result);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Parâmetros de tolerância/rodadas inválidos.';
end;
$$;

create or replace function wms.start_inventory_session(p_session uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.inventory_sessions; v_replay jsonb; v_bad jsonb; v_result jsonb;
begin
  select * into v_s from wms.inventory_sessions where id = p_session;
  if not found then raise exception using errcode = 'WA404', message = 'Inventário não encontrado.'; end if;
  perform wms.require(v_s.organization_id, 'inventory.manage', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'start_inventory_session', p_key, jsonb_build_object('s', p_session));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.inventory_sessions where id = p_session for update;
  perform wms._assert_transition('inventory', v_s.status, 'counting');
  -- trava os endereços (ordem determinística) contra movimentos concorrentes
  perform 1 from wms.locations where id in (select location_id from wms.inventory_session_locations where session_id = p_session)
   order by id for update;
  select jsonb_agg(jsonb_build_object('location', l.code, 'reason',
           case when l.counting_session_id is not null then 'em outro inventário'
                when exists (select 1 from wms.stock_balances b where b.location_id = l.id and b.reserved > 0) then 'tem reservas ativas'
                else 'tem estoque bloqueado/avariado/quarentena' end))
    into v_bad
    from wms.locations l
   where l.id in (select location_id from wms.inventory_session_locations where session_id = p_session)
     and (l.counting_session_id is not null
          or exists (select 1 from wms.stock_balances b where b.location_id = l.id and (b.reserved > 0 or (b.condition <> 'available' and b.quantity > 0))));
  if v_bad is not null then
    raise exception using errcode = 'WA409', message = 'Endereços não podem entrar em contagem agora.', detail = 'locations_unavailable', hint = v_bad::text;
  end if;
  update wms.locations set counting_session_id = p_session
   where id in (select location_id from wms.inventory_session_locations where session_id = p_session);
  update wms.inventory_sessions set status = 'counting', started_at = now(), version = version + 1 where id = p_session;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'inventory_started', 'inventory_session', p_session::text, '{}'::jsonb);
  v_result := jsonb_build_object('session_id', p_session, 'status', 'counting', 'round', 1);
  return wms._idem_finish(v_s.organization_id, p_key, v_result);
end;
$$;

-- Contagem cega: a resposta nunca traz o saldo esperado.
create or replace function wms.record_inventory_count(
  p_session uuid, p_count_id uuid, p_location_code text, p_code text, p_quantity numeric,
  p_lot_code text default null, p_expiry date default null, p_product uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s wms.inventory_sessions; v_uid uuid; v_replay jsonb; v_loc wms.locations; v_sl wms.inventory_session_locations;
  v_res record; v_prod wms.products; v_lot uuid; v_qty numeric; v_round integer; v_result jsonb;
begin
  select * into v_s from wms.inventory_sessions where id = p_session;
  if not found then raise exception using errcode = 'WA404', message = 'Inventário não encontrado.'; end if;
  v_uid := wms.require(v_s.organization_id, 'inventory.count', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'record_inventory_count', 'scan:' || p_count_id::text,
    jsonb_build_object('s', p_session, 'loc', p_location_code, 'code', p_code, 'q', p_quantity, 'lot', p_lot_code, 'e', p_expiry, 'p', p_product));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.inventory_sessions where id = p_session for share;
  if v_s.status <> 'counting' then
    raise exception using errcode = 'WA409', message = 'Inventário não está em contagem.', detail = v_s.status;
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception using errcode = 'WA422', message = 'Quantidade contada inválida.';
  end if;
  v_loc := wms._location_by_code(v_s.organization_id, v_s.warehouse_id, p_location_code);
  select * into v_sl from wms.inventory_session_locations where session_id = p_session and location_id = v_loc.id;
  if not found then
    raise exception using errcode = 'WA409', message = 'Endereço não faz parte deste inventário.', detail = 'location_not_in_session';
  end if;
  v_round := coalesce(v_sl.recount_round, 1);
  if v_s.current_round > 1 and v_round <> v_s.current_round then
    raise exception using errcode = 'WA409', message = 'Endereço não está marcado para recontagem nesta rodada.', detail = 'not_in_recount';
  end if;
  select * into v_res from wms._resolve_one(v_s.organization_id, p_code, p_product);
  select * into v_prod from wms.products where id = v_res.product_id;
  if v_prod.serial_control then
    raise exception using errcode = 'WA422', message = 'Produto com série: inventário por série ainda não implementado.', detail = 'serial_inventory_pending';
  end if;
  v_lot := wms._ensure_lot(v_s.organization_id, v_prod.id, p_lot_code, p_expiry);
  v_qty := p_quantity * v_res.factor;
  insert into wms.inventory_counts (id, organization_id, session_id, location_id, product_id, lot_id, round, counted_qty, counted_by)
  values (p_count_id, v_s.organization_id, p_session, v_loc.id, v_prod.id, v_lot, v_round, v_qty, v_uid);
  v_result := jsonb_build_object('count_id', p_count_id, 'location', v_loc.code, 'sku', v_prod.sku,
                                 'quantity_base', v_qty, 'unit', v_res.unit_code, 'round', v_round);
  return wms._idem_finish(v_s.organization_id, 'scan:' || p_count_id::text, v_result);
end;
$$;

-- Encerra a rodada: fora da tolerância => recontagem (até max_rounds); senão gera ajustes para aprovação.
create or replace function wms.close_inventory_round(p_session uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s wms.inventory_sessions; v_uid uuid; v_replay jsonb; d record; v_recount uuid[] := '{}'; v_adj integer := 0; v_result jsonb;
begin
  select * into v_s from wms.inventory_sessions where id = p_session;
  if not found then raise exception using errcode = 'WA404', message = 'Inventário não encontrado.'; end if;
  v_uid := wms.require(v_s.organization_id, 'inventory.manage', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'close_inventory_round', p_key, jsonb_build_object('s', p_session, 'r', v_s.current_round));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.inventory_sessions where id = p_session for update;
  if v_s.status <> 'counting' then
    raise exception using errcode = 'WA409', message = 'Inventário não está em contagem.', detail = v_s.status;
  end if;

  create temporary table if not exists pg_temp.inv_diff (location_id uuid, product_id uuid, lot_id uuid, expected numeric, counted numeric) on commit drop;
  delete from pg_temp.inv_diff;
  insert into pg_temp.inv_diff
  with sl as (
    select location_id, coalesce(recount_round, 1) as eff_round from wms.inventory_session_locations where session_id = p_session
  ), exp as (
    select b.location_id, b.product_id, b.lot_id, b.quantity
      from wms.stock_balances b join sl on sl.location_id = b.location_id
     where b.condition = 'available' and b.quantity > 0
  ), cnt as (
    select c.location_id, c.product_id, c.lot_id, sum(c.counted_qty) as qty
      from wms.inventory_counts c join sl on sl.location_id = c.location_id and c.round = sl.eff_round
     where c.session_id = p_session
     group by 1, 2, 3
  )
  select coalesce(e.location_id, c.location_id), coalesce(e.product_id, c.product_id), coalesce(e.lot_id, c.lot_id),
         coalesce(e.quantity, 0), coalesce(c.qty, 0)
    from exp e full join cnt c on c.location_id = e.location_id and c.product_id = e.product_id and c.lot_id is not distinct from e.lot_id;

  if v_s.current_round < v_s.max_rounds then
    select coalesce(array_agg(distinct location_id), '{}') into v_recount
      from pg_temp.inv_diff
     where counted <> expected
       and abs(counted - expected) > v_s.tolerance_qty
       and not (expected > 0 and abs(counted - expected) / expected * 100 <= v_s.tolerance_pct);
  end if;
  if cardinality(v_recount) > 0 then
    update wms.inventory_session_locations set recount_round = v_s.current_round + 1
     where session_id = p_session and location_id = any (v_recount);
    update wms.inventory_sessions set current_round = current_round + 1, version = version + 1 where id = p_session;
    perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'inventory_recount', 'inventory_session', p_session::text,
                       jsonb_build_object('round', v_s.current_round + 1, 'locations', v_recount));
    v_result := jsonb_build_object('session_id', p_session, 'status', 'counting', 'round', v_s.current_round + 1,
      'recount_locations', (select jsonb_agg(code order by code) from wms.locations where id = any (v_recount)));
    return wms._idem_finish(v_s.organization_id, p_key, v_result);
  end if;

  for d in select * from pg_temp.inv_diff where counted <> expected order by location_id, product_id loop
    insert into wms.inventory_adjustments (organization_id, warehouse_id, session_id, location_id, product_id, lot_id,
                                           expected_qty, counted_qty, difference, reason, requested_by)
    values (v_s.organization_id, v_s.warehouse_id, p_session, d.location_id, d.product_id, d.lot_id,
            d.expected, d.counted, d.counted - d.expected,
            case when v_s.kind = 'initial_load' then 'Carga inicial ' else 'Inventário ' end || v_s.code, v_uid);
    v_adj := v_adj + 1;
  end loop;
  perform wms._assert_transition('inventory', 'counting', 'review');
  update wms.inventory_sessions set status = 'review', version = version + 1 where id = p_session;
  if v_adj = 0 then
    perform wms._finish_inventory_if_done(p_session);
  end if;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'inventory_round_closed', 'inventory_session', p_session::text,
                     jsonb_build_object('adjustments', v_adj));
  v_result := jsonb_build_object('session_id', p_session,
    'status', (select status from wms.inventory_sessions where id = p_session), 'adjustments', v_adj);
  return wms._idem_finish(v_s.organization_id, p_key, v_result);
end;
$$;

create or replace function wms._finish_inventory_if_done(p_session uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.inventory_sessions;
begin
  select * into v_s from wms.inventory_sessions where id = p_session for update;
  if v_s.status <> 'review' or exists (select 1 from wms.inventory_adjustments where session_id = p_session and status = 'pending') then
    return false;
  end if;
  update wms.locations set counting_session_id = null where counting_session_id = p_session;
  update wms.inventory_sessions set status = 'closed', closed_at = now(), version = version + 1 where id = p_session;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'inventory_closed', 'inventory_session', p_session::text, '{}'::jsonb);
  return true;
end;
$$;

-- Aprovação: supervisor distinto de quem solicitou e de quem contou. Repetir não reaplica.
create or replace function wms.approve_inventory_adjustment(p_adjustment uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a wms.inventory_adjustments; v_s wms.inventory_sessions; v_uid uuid; v_replay jsonb; v_mov uuid; v_bal numeric;
  v_mode text; v_result jsonb;
begin
  select * into v_a from wms.inventory_adjustments where id = p_adjustment;
  if not found then raise exception using errcode = 'WA404', message = 'Ajuste não encontrado.'; end if;
  v_uid := wms.require(v_a.organization_id, 'inventory.approve', v_a.warehouse_id);
  v_replay := wms._idem_begin(v_a.organization_id, 'approve_inventory_adjustment', p_key, jsonb_build_object('a', p_adjustment));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.inventory_sessions where id = v_a.session_id for update;
  select * into v_a from wms.inventory_adjustments where id = p_adjustment for update;
  if v_a.status <> 'pending' then
    raise exception using errcode = 'WA409', message = 'Ajuste já decidido: nada é reaplicado.', detail = 'already_decided';
  end if;
  if v_uid = v_a.requested_by or exists (
      select 1 from wms.inventory_counts c
       where c.session_id = v_a.session_id and c.location_id = v_a.location_id and c.counted_by = v_uid) then
    raise exception using errcode = 'WA403', message = 'Autoaprovação não permitida: aprovador deve ser distinto de quem contou ou solicitou.', detail = 'self_approval';
  end if;
  select coalesce(sum(quantity), 0) into v_bal from wms.stock_balances
   where location_id = v_a.location_id and product_id = v_a.product_id and lot_id is not distinct from v_a.lot_id and condition = 'available';
  if v_bal <> v_a.expected_qty then
    raise exception using errcode = 'WA409', message = 'Saldo do endereço mudou desde a contagem. Refaça a contagem.', detail = 'balance_changed';
  end if;
  -- Carga inicial não é fato econômico novo no ERP; ajuste de inventário fica pendente de política.
  v_mode := case when v_s.kind = 'initial_load' then 'none'
                 when (select connection_id from wms._posting_policy(v_a.warehouse_id, 'outbound')) is null then 'none'
                 else 'blocked' end;
  v_mov := wms._new_movement(v_a.organization_id, v_a.warehouse_id, 'inventory_adjustment', v_a.reason,
                             'inventory_adjustment', p_adjustment, p_key, v_mode);
  perform wms._post_entry(v_mov, v_a.organization_id, v_a.warehouse_id, v_a.location_id, v_a.product_id, v_a.lot_id, null,
                          'available', v_a.difference, 0, true);
  if v_mode = 'blocked' then
    perform wms._outbox(v_a.organization_id, v_a.warehouse_id, (select connection_id from wms._posting_policy(v_a.warehouse_id, 'outbound')),
      'stock.post_adjustment', 'inventory_adjustment', p_adjustment,
      jsonb_build_object('movement_id', v_mov, 'product_id', v_a.product_id, 'difference', v_a.difference),
      'stock:' || v_mov::text, 'blocked', 'adjustment_policy_undefined');
  end if;
  update wms.inventory_adjustments set status = 'applied', decided_by = v_uid, decided_at = now(), movement_id = v_mov where id = p_adjustment;
  insert into wms.approvals (organization_id, warehouse_id, kind, entity_type, entity_id, requested_by, decided_by, decision)
  values (v_a.organization_id, v_a.warehouse_id, 'inventory_adjustment', 'inventory_adjustment', p_adjustment, v_a.requested_by, v_uid, 'approved');
  perform wms._audit(v_a.organization_id, v_a.warehouse_id, 'inventory_adjustment_approved', 'inventory_adjustment', p_adjustment::text,
                     jsonb_build_object('difference', v_a.difference, 'movement_id', v_mov));
  perform wms._finish_inventory_if_done(v_a.session_id);
  v_result := jsonb_build_object('adjustment_id', p_adjustment, 'status', 'applied', 'movement_id', v_mov,
                                 'session_status', (select status from wms.inventory_sessions where id = v_a.session_id));
  return wms._idem_finish(v_a.organization_id, p_key, v_result);
end;
$$;

create or replace function wms.reject_inventory_adjustment(p_adjustment uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_a wms.inventory_adjustments; v_uid uuid; v_replay jsonb; v_result jsonb;
begin
  select * into v_a from wms.inventory_adjustments where id = p_adjustment;
  if not found then raise exception using errcode = 'WA404', message = 'Ajuste não encontrado.'; end if;
  v_uid := wms.require(v_a.organization_id, 'inventory.approve', v_a.warehouse_id);
  v_replay := wms._idem_begin(v_a.organization_id, 'reject_inventory_adjustment', p_key, jsonb_build_object('a', p_adjustment, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  perform 1 from wms.inventory_sessions where id = v_a.session_id for update;
  select * into v_a from wms.inventory_adjustments where id = p_adjustment for update;
  if v_a.status <> 'pending' then
    raise exception using errcode = 'WA409', message = 'Ajuste já decidido.', detail = 'already_decided';
  end if;
  if v_uid = v_a.requested_by then
    raise exception using errcode = 'WA403', message = 'Decisão deve ser de supervisor distinto do solicitante.', detail = 'self_approval';
  end if;
  update wms.inventory_adjustments set status = 'rejected', decided_by = v_uid, decided_at = now() where id = p_adjustment;
  insert into wms.approvals (organization_id, warehouse_id, kind, entity_type, entity_id, requested_by, decided_by, decision, notes)
  values (v_a.organization_id, v_a.warehouse_id, 'inventory_adjustment', 'inventory_adjustment', p_adjustment, v_a.requested_by, v_uid, 'rejected', coalesce(p_reason, ''));
  perform wms._discrepancy(v_a.organization_id, v_a.warehouse_id, 'inventory_rejected', 'inventory_adjustment', p_adjustment,
                           v_a.product_id, v_a.location_id, v_a.difference, jsonb_build_object('reason', p_reason));
  perform wms._audit(v_a.organization_id, v_a.warehouse_id, 'inventory_adjustment_rejected', 'inventory_adjustment', p_adjustment::text,
                     jsonb_build_object('reason', p_reason));
  perform wms._finish_inventory_if_done(v_a.session_id);
  v_result := jsonb_build_object('adjustment_id', p_adjustment, 'status', 'rejected');
  return wms._idem_finish(v_a.organization_id, p_key, v_result);
end;
$$;

-- Cancelar libera os endereços sem apagar contagens nem histórico.
create or replace function wms.cancel_inventory_session(p_session uuid, p_reason text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_s wms.inventory_sessions; v_replay jsonb; v_result jsonb;
begin
  select * into v_s from wms.inventory_sessions where id = p_session;
  if not found then raise exception using errcode = 'WA404', message = 'Inventário não encontrado.'; end if;
  perform wms.require(v_s.organization_id, 'inventory.manage', v_s.warehouse_id);
  v_replay := wms._idem_begin(v_s.organization_id, 'cancel_inventory_session', p_key, jsonb_build_object('s', p_session, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  select * into v_s from wms.inventory_sessions where id = p_session for update;
  perform wms._assert_transition('inventory', v_s.status, 'cancelled');
  update wms.locations set counting_session_id = null where counting_session_id = p_session;
  update wms.inventory_adjustments set status = 'cancelled' where session_id = p_session and status = 'pending';
  update wms.inventory_sessions set status = 'cancelled', closed_at = now(), version = version + 1 where id = p_session;
  perform wms._audit(v_s.organization_id, v_s.warehouse_id, 'inventory_cancelled', 'inventory_session', p_session::text, jsonb_build_object('reason', p_reason));
  v_result := jsonb_build_object('session_id', p_session, 'status', 'cancelled');
  return wms._idem_finish(v_s.organization_id, p_key, v_result);
end;
$$;
