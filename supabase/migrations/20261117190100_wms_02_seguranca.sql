-- =====================================================================
-- WMS · 02 · Perfis, permissões, funções de autorização, RLS e grants
-- Negação por padrão: o papel `authenticated` só LÊ (com RLS) e executa
-- comandos (funções que validam identidade, vínculo ativo, permissão,
-- escopo de armazém e MFA). Nenhum INSERT/UPDATE/DELETE direto.
-- Papel/empresa/armazém enviados pelo cliente ou em user_metadata são ignorados:
-- tudo é lido das tabelas de vínculo.
-- =====================================================================

-- Papel técnico do worker de integração (sem login próprio; o backend/worker
-- conecta com o usuário do banco e faz SET ROLE wms_worker).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'wms_worker') then
    create role wms_worker nologin;
  end if;
end $$;
do $$ begin
  execute format('grant wms_worker to %I', current_user);
exception when others then
  raise notice 'Não foi possível conceder wms_worker a %: %', current_user, sqlerrm;
end $$;

grant usage on schema wms to authenticated, wms_worker;
alter default privileges in schema wms revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- Catálogo de perfis e permissões (dados de sistema, não fictícios)
-- ---------------------------------------------------------------------
insert into wms.roles (code, name, description) values
  ('admin', 'Administrador', 'Configurações, usuários e integração'),
  ('supervisor', 'Supervisor', 'Distribuição de tarefas, divergências e aprovações'),
  ('receiving', 'Recebimento', 'Conferir entregas e registrar evidências'),
  ('stocker', 'Estoquista', 'Armazenar, movimentar e reabastecer'),
  ('picker', 'Separador', 'Executar tarefas de separação atribuídas'),
  ('checker', 'Conferente', 'Conferir itens e embalar'),
  ('shipping', 'Expedição', 'Conferir volumes, romaneios e coleta'),
  ('auditor', 'Gestor/auditor', 'Consultar indicadores e histórico autorizado')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into wms.permissions (code, description, requires_mfa) values
  ('admin.settings', 'Alterar empresa, armazéns e configurações', true),
  ('users.manage', 'Convidar usuários, alterar perfis e acessos', true),
  ('integrations.manage', 'Configurar integração, políticas de lançamento e reprocessar', true),
  ('integrations.read', 'Consultar filas e estado da integração', false),
  ('catalog.manage', 'Cadastrar produtos, unidades, códigos e kits', false),
  ('locations.manage', 'Cadastrar e bloquear endereços', false),
  ('stock.read', 'Consultar saldos e movimentações', false),
  ('stock.putaway', 'Executar armazenagem e reabastecimento', false),
  ('stock.move', 'Transferir estoque entre endereços', false),
  ('stock.block', 'Bloquear e liberar estoque (condição)', false),
  ('receipts.create', 'Criar previsão manual de recebimento', false),
  ('receipts.check', 'Conferir itens recebidos', false),
  ('receipts.confirm', 'Confirmar recebimento aceito', false),
  ('receipts.review', 'Tratar divergências de recebimento', false),
  ('orders.read', 'Consultar pedidos', false),
  ('orders.allocate', 'Reservar estoque e criar tarefas', false),
  ('orders.cancel', 'Cancelar execução de pedido', false),
  ('orders.reconcile', 'Reconciliar pedido alterado no ERP', false),
  ('waves.manage', 'Criar ondas de separação', false),
  ('picking.execute', 'Executar separação', false),
  ('picking.supervise', 'Atribuir tarefas e tratar faltas', false),
  ('packing.execute', 'Conferir e embalar', false),
  ('labels.reprint', 'Reimprimir etiquetas internas', false),
  ('shipments.manage', 'Criar remessas e incluir pedidos', false),
  ('shipments.load', 'Conferir carregamento de volumes', false),
  ('shipments.dispatch', 'Confirmar saída física (despacho)', false),
  ('inventory.manage', 'Abrir, encerrar e cancelar inventários', false),
  ('inventory.count', 'Registrar contagens', false),
  ('inventory.approve', 'Aprovar ajustes de inventário', true),
  ('returns.manage', 'Abrir devoluções', false),
  ('returns.receive', 'Receber itens devolvidos', false),
  ('quality.decide', 'Decidir destinação de itens em quarentena', false),
  ('transfers.manage', 'Criar e expedir transferências entre armazéns', false),
  ('transfers.receive', 'Receber transferências', false),
  ('discrepancies.resolve', 'Resolver ocorrências', false),
  ('reports.read', 'Consultar indicadores', false),
  ('audit.read', 'Consultar auditoria', false),
  ('evidence.upload', 'Enviar evidências (fotos e documentos)', false)
on conflict (code) do update set description = excluded.description, requires_mfa = excluded.requires_mfa;

delete from wms.role_permissions;
insert into wms.role_permissions (role_code, permission_code)
select 'admin', code from wms.permissions
union all
select 'supervisor', code from wms.permissions
 where code not in ('admin.settings', 'users.manage', 'integrations.manage')
union all
select 'receiving', unnest(array['receipts.check', 'receipts.confirm', 'stock.read', 'evidence.upload', 'returns.receive', 'transfers.receive', 'orders.read'])
union all
select 'stocker', unnest(array['stock.read', 'stock.putaway', 'stock.move', 'inventory.count', 'transfers.receive', 'evidence.upload'])
union all
select 'picker', unnest(array['picking.execute', 'stock.read', 'orders.read'])
union all
select 'checker', unnest(array['packing.execute', 'labels.reprint', 'stock.read', 'orders.read', 'evidence.upload'])
union all
select 'shipping', unnest(array['shipments.manage', 'shipments.load', 'shipments.dispatch', 'labels.reprint', 'orders.read', 'stock.read'])
union all
select 'auditor', unnest(array['stock.read', 'orders.read', 'reports.read', 'audit.read', 'integrations.read']);

-- ---------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER com search_path fixo)
-- Sempre consultam o vínculo ATIVO: um usuário desativado perde acesso
-- mesmo com um JWT ainda válido.
-- ---------------------------------------------------------------------
create or replace function wms.my_org_ids()
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(m.organization_id), '{}')
    from wms.memberships m
    join wms.profiles p on p.user_id = m.user_id and p.active
    join wms.organizations o on o.id = m.organization_id and o.status = 'active'
   where m.user_id = auth.uid() and m.active;
$$;

create or replace function wms.my_warehouse_ids()
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct w.id), '{}')
    from wms.memberships m
    join wms.profiles p on p.user_id = m.user_id and p.active
    join wms.organizations o on o.id = m.organization_id and o.status = 'active'
    join wms.warehouses w on w.organization_id = m.organization_id
   where m.user_id = auth.uid() and m.active
     and (m.all_warehouses or exists (
       select 1 from wms.warehouse_access wa where wa.membership_id = m.id and wa.warehouse_id = w.id));
$$;

create or replace function wms.my_permission_orgs(p_perm text)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct m.organization_id), '{}')
    from wms.memberships m
    join wms.profiles p on p.user_id = m.user_id and p.active
    join wms.organizations o on o.id = m.organization_id and o.status = 'active'
    join wms.membership_roles mr on mr.membership_id = m.id
    join wms.role_permissions rp on rp.role_code = mr.role_code and rp.permission_code = p_perm
   where m.user_id = auth.uid() and m.active;
$$;

create or replace function wms.has_permission(p_org uuid, p_perm text, p_wh uuid default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from wms.memberships m
      join wms.profiles pr on pr.user_id = m.user_id and pr.active
      join wms.organizations o on o.id = m.organization_id and o.status = 'active'
      join wms.membership_roles mr on mr.membership_id = m.id
      join wms.role_permissions rp on rp.role_code = mr.role_code and rp.permission_code = p_perm
     where m.user_id = auth.uid()
       and m.organization_id = p_org
       and m.active
       and (p_wh is null or (
             exists (select 1 from wms.warehouses w where w.id = p_wh and w.organization_id = p_org and w.status = 'active')
         and (m.all_warehouses or exists (
               select 1 from wms.warehouse_access wa where wa.membership_id = m.id and wa.warehouse_id = p_wh)))));
$$;

-- Lança 401/403 (SQLSTATE WA401/WA403) e devolve o id do usuário.
create or replace function wms.require(p_org uuid, p_perm text, p_wh uuid default null)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mfa boolean;
begin
  if v_uid is null then
    raise exception using errcode = 'WA401', message = 'Autenticação necessária.';
  end if;
  if p_org is null or not wms.has_permission(p_org, p_perm, p_wh) then
    raise exception using errcode = 'WA403', message = 'Sem permissão para esta operação.', detail = p_perm;
  end if;
  select p.requires_mfa and o.require_mfa into v_mfa
    from wms.permissions p, wms.organizations o
   where p.code = p_perm and o.id = p_org;
  -- O claim `aal` vem do JWT verificado no servidor (Supabase Auth).
  if coalesce(v_mfa, false) and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = 'WA403', message = 'Esta operação exige verificação em duas etapas (MFA).', detail = 'mfa_required';
  end if;
  return v_uid;
end;
$$;

-- Resumo do usuário logado para a interface (não é usado para autorizar).
create or replace function wms.me()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'profile', (select jsonb_build_object('full_name', p.full_name, 'active', p.active) from wms.profiles p where p.user_id = auth.uid()),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', o.id, 'organization_code', o.code, 'organization_name', o.name, 'require_mfa', o.require_mfa,
        'roles', (select coalesce(jsonb_agg(mr.role_code order by mr.role_code), '[]') from wms.membership_roles mr where mr.membership_id = m.id),
        'permissions', (select coalesce(jsonb_agg(distinct rp.permission_code), '[]')
                          from wms.membership_roles mr join wms.role_permissions rp on rp.role_code = mr.role_code
                         where mr.membership_id = m.id),
        'warehouses', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) order by w.code), '[]')
                         from wms.warehouses w
                        where w.organization_id = o.id and w.status = 'active'
                          and (m.all_warehouses or exists (select 1 from wms.warehouse_access wa where wa.membership_id = m.id and wa.warehouse_id = w.id)))
      ) order by o.name)
        from wms.memberships m
        join wms.profiles p on p.user_id = m.user_id and p.active
        join wms.organizations o on o.id = m.organization_id and o.status = 'active'
       where m.user_id = auth.uid() and m.active), '[]'::jsonb)
  );
$$;

-- Conversão segura de texto para uuid (usada nas políticas de Storage)
create or replace function wms._try_uuid(p text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Caminho de arquivo privado: {organization_id}/{warehouse_id}/...
create or replace function wms.can_access_object(p_name text, p_perm text default 'stock.read')
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_org uuid;
  v_wh uuid;
begin
  if array_length(v_parts, 1) is null or array_length(v_parts, 1) < 3 then
    return false;
  end if;
  v_org := wms._try_uuid(v_parts[1]);
  v_wh := wms._try_uuid(v_parts[2]);
  if v_org is null or v_wh is null then
    return false;
  end if;
  return wms.has_permission(v_org, p_perm, v_wh);
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'warehouses', 'profiles', 'roles', 'permissions', 'role_permissions', 'memberships',
    'membership_roles', 'warehouse_access', 'products', 'product_units', 'product_barcodes', 'kit_components',
    'warehouse_zones', 'locations', 'location_products', 'lots', 'serial_numbers', 'handling_units',
    'integration_connections', 'erp_deposits', 'stock_posting_policies', 'external_mappings', 'sync_cursors',
    'stock_movements', 'stock_entries', 'stock_balances', 'orders', 'order_items', 'order_revisions',
    'stock_reservations', 'waves', 'picking_tasks', 'picking_items', 'scan_events', 'packing_checks',
    'packages', 'package_items', 'shipments', 'shipment_packages', 'dispatch_events', 'receipts',
    'receipt_items', 'receipt_checks', 'putaway_tasks', 'transfer_orders', 'transfer_items',
    'inventory_sessions', 'inventory_session_locations', 'inventory_counts', 'inventory_adjustments',
    'returns', 'return_items', 'quality_decisions', 'inbox_events', 'outbox_events', 'integration_jobs',
    'integration_attempts', 'rate_limit_windows', 'discrepancies', 'approvals', 'command_log',
    'audit_events', 'state_transitions']
  loop
    execute format('alter table wms.%I enable row level security', t);
    execute format('revoke all on wms.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Tabelas de referência do sistema
do $$
declare t text;
begin
  foreach t in array array['roles', 'permissions', 'role_permissions', 'state_transitions'] loop
    execute format('drop policy if exists ref_read on wms.%I', t);
    execute format('create policy ref_read on wms.%I for select to authenticated using (true)', t);
    execute format('grant select on wms.%I to authenticated', t);
  end loop;
end $$;

-- Tabelas com escopo de empresa
do $$
declare t text;
begin
  foreach t in array array['products', 'product_units', 'product_barcodes', 'kit_components', 'lots',
                            'serial_numbers', 'memberships', 'warehouse_access'] loop
    execute format('drop policy if exists org_read on wms.%I', t);
    execute format('create policy org_read on wms.%I for select to authenticated using (organization_id = any ((select wms.my_org_ids())::uuid[]))', t);
    execute format('grant select on wms.%I to authenticated', t);
  end loop;
end $$;

-- Tabelas com escopo de armazém
do $$
declare t text;
begin
  foreach t in array array['warehouse_zones', 'locations', 'location_products', 'handling_units', 'stock_movements',
                            'stock_entries', 'stock_balances', 'orders', 'stock_reservations', 'waves', 'picking_tasks',
                            'scan_events', 'packing_checks', 'packages', 'shipments', 'receipts', 'putaway_tasks',
                            'inventory_sessions', 'inventory_adjustments', 'returns', 'quality_decisions'] loop
    execute format('drop policy if exists wh_read on wms.%I', t);
    execute format('create policy wh_read on wms.%I for select to authenticated using (warehouse_id = any ((select wms.my_warehouse_ids())::uuid[]))', t);
    execute format('grant select on wms.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists org_self on wms.organizations;
create policy org_self on wms.organizations for select to authenticated using (id = any ((select wms.my_org_ids())::uuid[]));
grant select on wms.organizations to authenticated;

drop policy if exists wh_self on wms.warehouses;
create policy wh_self on wms.warehouses for select to authenticated using (id = any ((select wms.my_warehouse_ids())::uuid[]));
grant select on wms.warehouses to authenticated;

-- Perfis: o próprio e colegas da mesma empresa (para atribuição e rastreabilidade)
drop policy if exists profile_read on wms.profiles;
create policy profile_read on wms.profiles for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from wms.memberships m where m.user_id = profiles.user_id and m.organization_id = any ((select wms.my_org_ids())::uuid[]))
);
grant select on wms.profiles to authenticated;

drop policy if exists membership_roles_read on wms.membership_roles;
create policy membership_roles_read on wms.membership_roles for select to authenticated using (
  exists (select 1 from wms.memberships m where m.id = membership_roles.membership_id and m.organization_id = any ((select wms.my_org_ids())::uuid[]))
);
grant select on wms.membership_roles to authenticated;

-- Filhas sem warehouse_id: herdam o escopo do pai
drop policy if exists child_read on wms.order_items;
create policy child_read on wms.order_items for select to authenticated using (
  exists (select 1 from wms.orders o where o.id = order_items.order_id and o.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.order_revisions;
create policy child_read on wms.order_revisions for select to authenticated using (
  exists (select 1 from wms.orders o where o.id = order_revisions.order_id and o.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.picking_items;
create policy child_read on wms.picking_items for select to authenticated using (
  exists (select 1 from wms.picking_tasks t where t.id = picking_items.task_id and t.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.package_items;
create policy child_read on wms.package_items for select to authenticated using (
  exists (select 1 from wms.packages p where p.id = package_items.package_id and p.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.shipment_packages;
create policy child_read on wms.shipment_packages for select to authenticated using (
  exists (select 1 from wms.shipments s where s.id = shipment_packages.shipment_id and s.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.dispatch_events;
create policy child_read on wms.dispatch_events for select to authenticated using (
  exists (select 1 from wms.shipments s where s.id = dispatch_events.shipment_id and s.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.receipt_items;
create policy child_read on wms.receipt_items for select to authenticated using (
  exists (select 1 from wms.receipts r where r.id = receipt_items.receipt_id and r.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.receipt_checks;
create policy child_read on wms.receipt_checks for select to authenticated using (
  exists (select 1 from wms.receipts r where r.id = receipt_checks.receipt_id and r.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists child_read on wms.transfer_orders;
create policy child_read on wms.transfer_orders for select to authenticated using (
  from_warehouse_id = any ((select wms.my_warehouse_ids())::uuid[]) or to_warehouse_id = any ((select wms.my_warehouse_ids())::uuid[]));
drop policy if exists child_read on wms.transfer_items;
create policy child_read on wms.transfer_items for select to authenticated using (
  exists (select 1 from wms.transfer_orders t where t.id = transfer_items.transfer_id
           and (t.from_warehouse_id = any ((select wms.my_warehouse_ids())::uuid[]) or t.to_warehouse_id = any ((select wms.my_warehouse_ids())::uuid[]))));
drop policy if exists child_read on wms.inventory_session_locations;
create policy child_read on wms.inventory_session_locations for select to authenticated using (
  exists (select 1 from wms.inventory_sessions s where s.id = inventory_session_locations.session_id and s.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
-- Contagem cega: o contador vê só as próprias contagens; quem gerencia o inventário vê todas.
drop policy if exists child_read on wms.inventory_counts;
create policy child_read on wms.inventory_counts for select to authenticated using (
  exists (select 1 from wms.inventory_sessions s where s.id = inventory_counts.session_id
           and s.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])
           and (inventory_counts.counted_by = (select auth.uid())
                or wms.has_permission(s.organization_id, 'inventory.manage', s.warehouse_id)
                or wms.has_permission(s.organization_id, 'inventory.approve', s.warehouse_id))));
drop policy if exists child_read on wms.return_items;
create policy child_read on wms.return_items for select to authenticated using (
  exists (select 1 from wms.returns r where r.id = return_items.return_id and r.warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
grant select on wms.order_items, wms.order_revisions, wms.picking_items, wms.package_items, wms.shipment_packages,
  wms.dispatch_events, wms.receipt_items, wms.receipt_checks, wms.transfer_orders, wms.transfer_items,
  wms.inventory_session_locations, wms.inventory_counts, wms.return_items to authenticated;

-- Ocorrências e aprovações: empresa + armazém (quando houver)
drop policy if exists disc_read on wms.discrepancies;
create policy disc_read on wms.discrepancies for select to authenticated using (
  organization_id = any ((select wms.my_org_ids())::uuid[])
  and (warehouse_id is null or warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
drop policy if exists appr_read on wms.approvals;
create policy appr_read on wms.approvals for select to authenticated using (
  organization_id = any ((select wms.my_org_ids())::uuid[])
  and (warehouse_id is null or warehouse_id = any ((select wms.my_warehouse_ids())::uuid[])));
grant select on wms.discrepancies, wms.approvals to authenticated;

-- Auditoria: somente com audit.read
drop policy if exists audit_read on wms.audit_events;
create policy audit_read on wms.audit_events for select to authenticated using (
  organization_id = any ((select wms.my_permission_orgs('audit.read'))::uuid[]));
grant select on wms.audit_events to authenticated;

-- Integração: leitura com integrations.read/manage. Segredos NUNCA são concedidos (grant por coluna).
do $$
declare t text;
begin
  foreach t in array array['erp_deposits', 'stock_posting_policies', 'external_mappings', 'inbox_events',
                            'outbox_events', 'integration_jobs', 'integration_attempts'] loop
    execute format('drop policy if exists integ_read on wms.%I', t);
    execute format('create policy integ_read on wms.%I for select to authenticated using (
      organization_id = any ((select wms.my_permission_orgs(''integrations.read''))::uuid[]) or
      organization_id = any ((select wms.my_permission_orgs(''integrations.manage''))::uuid[]))', t);
    execute format('grant select on wms.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists integ_read on wms.integration_connections;
create policy integ_read on wms.integration_connections for select to authenticated using (
  organization_id = any ((select wms.my_permission_orgs('integrations.read'))::uuid[]) or
  organization_id = any ((select wms.my_permission_orgs('integrations.manage'))::uuid[]));
grant select (id, organization_id, provider, api_version, adapter, name, status, status_reason, write_enabled,
              access_token_expires_at, refresh_token_expires_at, eligible_order_statuses, settings, created_at, updated_at)
  on wms.integration_connections to authenticated;
-- command_log, sync_cursors e rate_limit_windows: sem leitura pelo app (uso interno).
