-- =====================================================================
-- WMS · 11 · Indicadores, Storage privado e grants finais
-- =====================================================================

-- Indicadores: sempre com período, unidade e denominador; nulo quando o denominador é zero.
create or replace function wms.kpis(p_wh uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v jsonb;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'reports.read', p_wh);
  with
  ord as (select status, count(*) n from wms.orders where warehouse_id = p_wh group by status),
  rec as (select count(*) n, avg(extract(epoch from closed_at - started_at) / 60) m
            from wms.receipts where warehouse_id = p_wh and status = 'received' and closed_at between p_from and p_to and started_at is not null),
  put as (select count(*) n, avg(extract(epoch from completed_at - created_at) / 60) m
            from wms.putaway_tasks where warehouse_id = p_wh and kind = 'putaway' and status = 'completed' and completed_at between p_from and p_to),
  prod as (
    select t.assigned_to, count(distinct pi.id) lines, sum(pi.picked_qty) units,
           sum(extract(epoch from t.completed_at - t.started_at)) / 3600.0 hours
      from wms.picking_tasks t join wms.picking_items pi on pi.task_id = t.id
     where t.warehouse_id = p_wh and t.status = 'completed' and t.completed_at between p_from and p_to and t.started_at is not null
     group by t.assigned_to),
  chk as (
    select count(*) total,
           count(*) filter (where not exists (select 1 from wms.discrepancies d where d.entity_type = 'receipt_item' and d.entity_id = i.id)) ok
      from wms.receipt_items i join wms.receipts r on r.id = i.receipt_id
     where r.warehouse_id = p_wh and r.closed_at between p_from and p_to),
  inv as (
    select count(*) total,
           count(*) filter (where not exists (select 1 from wms.inventory_adjustments a where a.session_id = c.session_id
                                                and a.location_id = c.location_id and a.product_id = c.product_id)) ok
      from (select distinct c.session_id, c.location_id, c.product_id from wms.inventory_counts c
              join wms.inventory_sessions s on s.id = c.session_id
             where s.warehouse_id = p_wh and s.status = 'closed' and s.closed_at between p_from and p_to) c),
  shp as (
    select count(*) total, count(*) filter (where o.dispatched_at <= o.ship_by) ok
      from wms.orders o where o.warehouse_id = p_wh and o.ship_by is not null and o.ship_by between p_from and p_to
       and o.status <> 'cancelled'),
  integ as (
    select count(*) filter (where e.status in ('pending', 'processing')) pending,
           count(*) filter (where e.status = 'failed') failed,
           count(*) filter (where e.status = 'unknown') unknown,
           count(*) filter (where e.status = 'blocked') blocked,
           extract(epoch from now() - min(e.created_at) filter (where e.status in ('pending', 'processing', 'unknown'))) / 60 oldest_min
      from wms.outbox_events e where e.warehouse_id = p_wh),
  att as (
    select count(*) total, count(*) filter (where a.outcome in ('transient_error', 'permanent_error', 'unknown')) bad
      from wms.integration_attempts a join wms.integration_connections c on c.id = a.connection_id
     where c.organization_id = v_wh.organization_id and a.started_at between p_from and p_to and a.outbox_id is not null)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', 'America/Sao_Paulo'),
    'orders_by_status', jsonb_build_object('unit', 'pedidos', 'values', coalesce((select jsonb_object_agg(status, n) from ord), '{}'::jsonb)),
    'receipt_time', jsonb_build_object('unit', 'minutos (média)', 'denominator', (select n from rec), 'value', (select round(m::numeric, 1) from rec)),
    'putaway_time', jsonb_build_object('unit', 'minutos (média)', 'denominator', (select n from put), 'value', (select round(m::numeric, 1) from put)),
    'productivity', jsonb_build_object('unit', 'linhas e unidades por hora efetiva de tarefa', 'by_user',
      coalesce((select jsonb_agg(jsonb_build_object('user_id', assigned_to, 'lines', lines, 'units', units, 'hours', round(hours::numeric, 2),
                  'lines_per_hour', case when hours > 0 then round((lines / hours)::numeric, 1) end,
                  'units_per_hour', case when hours > 0 then round((units / hours)::numeric, 1) end)) from prod), '[]'::jsonb)),
    'receipt_accuracy', jsonb_build_object('unit', 'linhas sem divergência / linhas conferidas', 'numerator', (select ok from chk),
      'denominator', (select total from chk), 'value', (select case when total > 0 then round(ok::numeric / total * 100, 1) end from chk)),
    'inventory_accuracy', jsonb_build_object('unit', 'posições/produtos sem divergência / contados', 'numerator', (select ok from inv),
      'denominator', (select total from inv), 'value', (select case when total > 0 then round(ok::numeric / total * 100, 1) end from inv)),
    'on_time_dispatch', jsonb_build_object('unit', 'pedidos expedidos até o prazo / pedidos com prazo no período', 'numerator', (select ok from shp),
      'denominator', (select total from shp), 'value', (select case when total > 0 then round(ok::numeric / total * 100, 1) end from shp)),
    'integration', jsonb_build_object('pending', (select pending from integ), 'failed', (select failed from integ),
      'unknown', (select unknown from integ), 'blocked', (select blocked from integ),
      'oldest_pending_minutes', (select round(oldest_min::numeric, 1) from integ),
      'attempt_failure_rate', jsonb_build_object('numerator', (select bad from att), 'denominator', (select total from att),
         'value', (select case when total > 0 then round(bad::numeric / total * 100, 1) end from att)),
      'reauthorization_required', (select count(*) from wms.integration_connections where organization_id = v_wh.organization_id and status = 'reauthorization_required'))
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Storage privado (evidências): caminho {organization_id}/{warehouse_id}/...
-- Aplicado só onde o schema storage existe (Supabase).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('wms-evidencias', 'wms-evidencias', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists wms_evidencias_read on storage.objects';
    execute $p$create policy wms_evidencias_read on storage.objects for select to authenticated
      using (bucket_id = 'wms-evidencias' and wms.can_access_object(name, 'stock.read'))$p$;
    execute 'drop policy if exists wms_evidencias_insert on storage.objects';
    execute $p$create policy wms_evidencias_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'wms-evidencias' and wms.can_access_object(name, 'evidence.upload'))$p$;
    -- sem update/delete: evidência não é sobrescrita nem apagada pelo app
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Grants de execução (negação por padrão)
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'wms' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public', f.sig);
    if f.proname like 'worker\_%' or f.proname = 'inbox_receive' then
      execute format('grant execute on function %s to wms_worker', f.sig);
    elsif f.proname like '\_%' or f.proname in ('bootstrap_organization', 'rebuild_balances',
                                                'check_balances_against_ledger', 'check_reservations_against_balances') then
      null; -- internas: chamadas apenas por outras funções do dono
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  -- Usadas por políticas RLS e pelos comandos (executam no contexto do usuário)
  grant execute on function wms._try_uuid(text) to authenticated;
  grant execute on function wms.check_balances_against_ledger(uuid), wms.check_reservations_against_balances(uuid) to wms_worker;
end $$;
