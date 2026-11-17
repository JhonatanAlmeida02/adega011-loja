-- =====================================================================
-- WMS · 04 · Cadastros e administração
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bootstrap administrativo controlado: só o dono do banco executa
-- (script `npm run wms:bootstrap`, com um usuário já criado/convidado no
-- Supabase Auth). Não existe senha fixa em seed.
-- ---------------------------------------------------------------------
create or replace function wms.bootstrap_organization(p_user_id uuid, p_org_code text, p_org_name text, p_full_name text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_membership uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = 'WA404', message = 'Usuário não existe no Supabase Auth.';
  end if;
  select id into v_org from wms.organizations where code = upper(p_org_code);
  if v_org is null then
    insert into wms.organizations (code, name) values (upper(p_org_code), p_org_name) returning id into v_org;
  elsif exists (select 1 from wms.memberships m join wms.membership_roles r on r.membership_id = m.id
                 where m.organization_id = v_org and m.active and r.role_code = 'admin') then
    raise exception using errcode = 'WA409', message = 'A empresa já tem administrador: use o convite pela interface.';
  end if;
  insert into wms.profiles (user_id, full_name) values (p_user_id, coalesce(p_full_name, ''))
  on conflict (user_id) do update set active = true;
  insert into wms.memberships (organization_id, user_id, all_warehouses) values (v_org, p_user_id, true)
  on conflict (organization_id, user_id) do update set active = true, all_warehouses = true, deactivated_at = null
  returning id into v_membership;
  insert into wms.membership_roles (membership_id, role_code) values (v_membership, 'admin') on conflict do nothing;
  insert into wms.audit_events (organization_id, actor_id, action, entity_type, entity_id, data)
  values (v_org, null, 'bootstrap_admin', 'membership', v_membership::text, jsonb_build_object('user_id', p_user_id));
  return v_org;
end;
$$;
revoke all on function wms.bootstrap_organization(uuid, text, text, text) from public, authenticated;

-- ---------------------------------------------------------------------
-- Empresa e armazéns
-- ---------------------------------------------------------------------
create or replace function wms.update_organization_settings(p_org uuid, p_name text, p_require_mfa boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  v_uid := wms.require(p_org, 'admin.settings');
  update wms.organizations set name = coalesce(nullif(trim(p_name), ''), name), require_mfa = coalesce(p_require_mfa, require_mfa)
   where id = p_org;
  perform wms._audit(p_org, null, 'organization_updated', 'organization', p_org::text,
                     jsonb_build_object('name', p_name, 'require_mfa', p_require_mfa));
  return jsonb_build_object('organization_id', p_org);
end;
$$;

-- Cria o armazém com endereços técnicos padrão (recebimento, staging, quarentena, devoluções, trânsito, doca).
create or replace function wms.create_warehouse(p_org uuid, p_code text, p_name text, p_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_replay jsonb;
  v_wh uuid;
  v_result jsonb;
  v_code text := upper(trim(p_code));
begin
  v_uid := wms.require(p_org, 'admin.settings');
  v_replay := wms._idem_begin(p_org, 'create_warehouse', p_key, jsonb_build_object('code', v_code, 'name', p_name));
  if v_replay is not null then return v_replay; end if;
  if exists (select 1 from wms.warehouses where organization_id = p_org and code = v_code) then
    raise exception using errcode = 'WA409', message = format('Armazém %s já existe.', v_code);
  end if;
  insert into wms.warehouses (organization_id, code, name) values (p_org, v_code, p_name) returning id into v_wh;
  insert into wms.locations (organization_id, warehouse_id, code, type, sort_order) values
    (p_org, v_wh, 'RECEB', 'receiving', 0),
    (p_org, v_wh, 'STAGE', 'staging', 900),
    (p_org, v_wh, 'QUAR', 'quarantine', 910),
    (p_org, v_wh, 'DEVOL', 'returns', 920),
    (p_org, v_wh, 'TRANSITO', 'transit', 930),
    (p_org, v_wh, 'DOCA-1', 'dock', 940);
  update wms.warehouses w set
    receiving_location_id = (select id from wms.locations where warehouse_id = v_wh and code = 'RECEB'),
    staging_location_id = (select id from wms.locations where warehouse_id = v_wh and code = 'STAGE'),
    quarantine_location_id = (select id from wms.locations where warehouse_id = v_wh and code = 'QUAR'),
    returns_location_id = (select id from wms.locations where warehouse_id = v_wh and code = 'DEVOL'),
    transit_location_id = (select id from wms.locations where warehouse_id = v_wh and code = 'TRANSITO')
   where w.id = v_wh;
  perform wms._audit(p_org, v_wh, 'warehouse_created', 'warehouse', v_wh::text, jsonb_build_object('code', v_code));
  v_result := jsonb_build_object('warehouse_id', v_wh, 'code', v_code);
  return wms._idem_finish(p_org, p_key, v_result);
end;
$$;

create or replace function wms.update_warehouse(p_wh uuid, p_name text, p_require_fiscal_release boolean, p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'admin.settings');
  update wms.warehouses set name = coalesce(nullif(trim(p_name), ''), name),
         require_fiscal_release = coalesce(p_require_fiscal_release, require_fiscal_release),
         status = coalesce(p_status, status)
   where id = p_wh;
  perform wms._audit(v_wh.organization_id, p_wh, 'warehouse_updated', 'warehouse', p_wh::text,
    jsonb_build_object('name', p_name, 'require_fiscal_release', p_require_fiscal_release, 'status', p_status));
  return jsonb_build_object('warehouse_id', p_wh);
end;
$$;

-- ---------------------------------------------------------------------
-- Zonas e endereços
-- ---------------------------------------------------------------------
create or replace function wms.upsert_zone(p_wh uuid, p_code text, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_id uuid;
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'locations.manage', p_wh);
  insert into wms.warehouse_zones (organization_id, warehouse_id, code, name)
  values (v_wh.organization_id, p_wh, upper(trim(p_code)), coalesce(p_name, ''))
  on conflict (warehouse_id, code) do update set name = excluded.name
  returning id into v_id;
  perform wms._audit(v_wh.organization_id, p_wh, 'zone_saved', 'zone', v_id::text, jsonb_build_object('code', p_code));
  return jsonb_build_object('zone_id', v_id);
end;
$$;

create or replace function wms.upsert_location(
  p_wh uuid, p_code text, p_type text, p_zone_code text default null, p_pickable boolean default false,
  p_capacity numeric default null, p_sort integer default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_wh wms.warehouses; v_zone uuid; v_id uuid; v_code text := upper(trim(p_code));
begin
  select * into v_wh from wms.warehouses where id = p_wh;
  if not found then raise exception using errcode = 'WA404', message = 'Armazém não encontrado.'; end if;
  perform wms.require(v_wh.organization_id, 'locations.manage', p_wh);
  if p_zone_code is not null then
    select id into v_zone from wms.warehouse_zones where warehouse_id = p_wh and code = upper(trim(p_zone_code));
    if v_zone is null then raise exception using errcode = 'WA404', message = format('Zona %s não existe.', p_zone_code); end if;
  end if;
  if exists (select 1 from wms.locations where warehouse_id = p_wh and code = v_code and type <> p_type)
     and exists (select 1 from wms.stock_balances b join wms.locations l on l.id = b.location_id
                  where l.warehouse_id = p_wh and l.code = v_code and b.quantity > 0) then
    raise exception using errcode = 'WA409', message = 'Endereço com saldo não pode mudar de tipo.';
  end if;
  insert into wms.locations (organization_id, warehouse_id, zone_id, code, type, pickable, capacity_units, sort_order)
  values (v_wh.organization_id, p_wh, v_zone, v_code, p_type, coalesce(p_pickable, false), p_capacity, coalesce(p_sort, 0))
  on conflict (warehouse_id, code) do update
    set zone_id = excluded.zone_id, type = excluded.type, pickable = excluded.pickable,
        capacity_units = excluded.capacity_units, sort_order = excluded.sort_order
  returning id into v_id;
  perform wms._audit(v_wh.organization_id, p_wh, 'location_saved', 'location', v_id::text,
    jsonb_build_object('code', v_code, 'type', p_type, 'pickable', p_pickable, 'capacity', p_capacity));
  return jsonb_build_object('location_id', v_id, 'code', v_code);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Dados do endereço inválidos (tipo, código ou separação não permitida para o tipo).';
end;
$$;

create or replace function wms.set_location_block(p_location uuid, p_blocked boolean, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_loc wms.locations;
begin
  select * into v_loc from wms.locations where id = p_location;
  if not found then raise exception using errcode = 'WA404', message = 'Endereço não encontrado.'; end if;
  perform wms.require(v_loc.organization_id, 'locations.manage', v_loc.warehouse_id);
  if p_blocked and coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'WA422', message = 'Informe o motivo do bloqueio.';
  end if;
  update wms.locations set blocked = p_blocked, block_reason = case when p_blocked then p_reason end where id = p_location;
  perform wms._audit(v_loc.organization_id, v_loc.warehouse_id, case when p_blocked then 'location_blocked' else 'location_unblocked' end,
                     'location', p_location::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('location_id', p_location, 'blocked', p_blocked);
end;
$$;

create or replace function wms.set_location_product_limits(p_location uuid, p_product uuid, p_min numeric, p_max numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_loc wms.locations;
begin
  select * into v_loc from wms.locations where id = p_location;
  if not found then raise exception using errcode = 'WA404', message = 'Endereço não encontrado.'; end if;
  perform wms.require(v_loc.organization_id, 'locations.manage', v_loc.warehouse_id);
  if not v_loc.pickable then
    raise exception using errcode = 'WA422', message = 'Mínimo/máximo só se aplica a endereços de separação.';
  end if;
  insert into wms.location_products (organization_id, warehouse_id, location_id, product_id, min_qty, max_qty)
  values (v_loc.organization_id, v_loc.warehouse_id, p_location, p_product, p_min, p_max)
  on conflict (location_id, product_id) do update set min_qty = excluded.min_qty, max_qty = excluded.max_qty;
  return jsonb_build_object('location_id', p_location, 'product_id', p_product);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Mínimo e máximo inválidos.';
end;
$$;

-- ---------------------------------------------------------------------
-- Produtos (manuais; os do ERP chegam pelo worker com mapeamento externo)
-- ---------------------------------------------------------------------
create or replace function wms.upsert_product(
  p_org uuid, p_sku text, p_description text, p_gtin text default null, p_base_unit text default 'UN',
  p_lot_control boolean default false, p_expiry_control boolean default false, p_serial_control boolean default false,
  p_min_shelf_days integer default 0, p_kit_policy text default 'none')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_old wms.products;
begin
  perform wms.require(p_org, 'catalog.manage');
  select * into v_old from wms.products where organization_id = p_org and sku = trim(p_sku);
  if found and (v_old.lot_control <> p_lot_control or v_old.serial_control <> p_serial_control)
     and exists (select 1 from wms.stock_entries where product_id = v_old.id) then
    raise exception using errcode = 'WA409', message = 'Produto com histórico não pode trocar controle de lote/série.';
  end if;
  insert into wms.products (organization_id, sku, description, gtin, base_unit, lot_control, expiry_control, serial_control, min_shelf_days, kit_policy)
  values (p_org, trim(p_sku), trim(p_description), nullif(trim(p_gtin), ''), upper(coalesce(p_base_unit, 'UN')),
          p_lot_control, p_expiry_control, p_serial_control, coalesce(p_min_shelf_days, 0), coalesce(p_kit_policy, 'none'))
  on conflict (organization_id, sku) do update
    set description = excluded.description, gtin = excluded.gtin, base_unit = excluded.base_unit,
        lot_control = excluded.lot_control, expiry_control = excluded.expiry_control,
        serial_control = excluded.serial_control, min_shelf_days = excluded.min_shelf_days,
        kit_policy = excluded.kit_policy, updated_at = now()
  returning id into v_id;
  perform wms._audit(p_org, null, 'product_saved', 'product', v_id::text, jsonb_build_object('sku', p_sku));
  return jsonb_build_object('product_id', v_id);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Dados do produto inválidos (GTIN só números, validade exige lote).';
end;
$$;

-- Unidade logística com fator explícito (ex.: CX12 = 12 UN) e código de barras opcional.
create or replace function wms.upsert_product_unit(p_product uuid, p_code text, p_factor numeric, p_barcode text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prod wms.products; v_unit uuid;
begin
  select * into v_prod from wms.products where id = p_product;
  if not found then raise exception using errcode = 'WA404', message = 'Produto não encontrado.'; end if;
  perform wms.require(v_prod.organization_id, 'catalog.manage');
  if v_prod.serial_control and p_factor <> 1 then
    raise exception using errcode = 'WA422', message = 'Produto com série usa somente unidade com fator 1.';
  end if;
  insert into wms.product_units (organization_id, product_id, code, factor)
  values (v_prod.organization_id, p_product, upper(trim(p_code)), p_factor)
  on conflict (product_id, code) do update set factor = excluded.factor
  returning id into v_unit;
  if p_barcode is not null then
    insert into wms.product_barcodes (organization_id, product_id, unit_id, barcode)
    values (v_prod.organization_id, p_product, v_unit, trim(p_barcode))
    on conflict (product_id, barcode) do update set unit_id = excluded.unit_id;
  end if;
  perform wms._audit(v_prod.organization_id, null, 'product_unit_saved', 'product', p_product::text,
                     jsonb_build_object('unit', p_code, 'factor', p_factor, 'barcode', p_barcode));
  return jsonb_build_object('unit_id', v_unit);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Unidade inválida (código ou fator).';
end;
$$;

create or replace function wms.add_barcode(p_product uuid, p_barcode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prod wms.products;
begin
  select * into v_prod from wms.products where id = p_product;
  if not found then raise exception using errcode = 'WA404', message = 'Produto não encontrado.'; end if;
  perform wms.require(v_prod.organization_id, 'catalog.manage');
  insert into wms.product_barcodes (organization_id, product_id, barcode)
  values (v_prod.organization_id, p_product, trim(p_barcode))
  on conflict (product_id, barcode) do nothing;
  return jsonb_build_object('product_id', p_product, 'barcode', p_barcode);
exception when check_violation then
  raise exception using errcode = 'WA422', message = 'Código de barras inválido.';
end;
$$;

-- Kit: substitui a composição inteira (atômico). Kits aninhados não são aceitos.
create or replace function wms.set_kit_components(p_kit uuid, p_components jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_kit wms.products; c record;
begin
  select * into v_kit from wms.products where id = p_kit;
  if not found then raise exception using errcode = 'WA404', message = 'Kit não encontrado.'; end if;
  perform wms.require(v_kit.organization_id, 'catalog.manage');
  if v_kit.kit_policy = 'none' then
    raise exception using errcode = 'WA422', message = 'Defina a política do kit (componentes ou montado) antes da composição.';
  end if;
  delete from wms.kit_components where kit_product_id = p_kit;
  for c in select (x->>'product_id')::uuid as product_id, (x->>'quantity')::numeric as quantity
             from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) x loop
    if exists (select 1 from wms.products where id = c.product_id and kit_policy <> 'none') then
      raise exception using errcode = 'WA422', message = 'Kits aninhados não são permitidos.';
    end if;
    insert into wms.kit_components (organization_id, kit_product_id, component_product_id, quantity)
    values (v_kit.organization_id, p_kit, c.product_id, c.quantity);
  end loop;
  perform wms._audit(v_kit.organization_id, null, 'kit_saved', 'product', p_kit::text, jsonb_build_object('components', p_components));
  return jsonb_build_object('kit_id', p_kit, 'components', jsonb_array_length(coalesce(p_components, '[]'::jsonb)));
exception
  when foreign_key_violation then
    raise exception using errcode = 'WA422', message = 'Componente inválido ou de outra empresa.';
  when check_violation then
    raise exception using errcode = 'WA422', message = 'Quantidade do componente inválida.';
end;
$$;

-- ---------------------------------------------------------------------
-- Usuários e acessos (cadastro só por convite: o backend convida pelo
-- Supabase Auth com a chave secreta e então registra o vínculo aqui).
-- ---------------------------------------------------------------------
create or replace function wms.save_member(
  p_org uuid, p_user_id uuid, p_full_name text, p_roles text[], p_all_warehouses boolean, p_warehouses uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid; v_m uuid; v_wh uuid;
begin
  v_uid := wms.require(p_org, 'users.manage');
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = 'WA404', message = 'Usuário não encontrado no Supabase Auth (convide primeiro).';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception using errcode = 'WA422', message = 'Informe ao menos um perfil.';
  end if;
  if exists (select 1 from unnest(p_roles) r where r not in (select code from wms.roles)) then
    raise exception using errcode = 'WA422', message = 'Perfil inexistente.';
  end if;
  if p_user_id = v_uid and not ('admin' = any (p_roles)) then
    raise exception using errcode = 'WA409', message = 'Você não pode remover o próprio perfil de administrador.';
  end if;
  insert into wms.profiles (user_id, full_name) values (p_user_id, coalesce(p_full_name, ''))
  on conflict (user_id) do update set full_name = coalesce(nullif(excluded.full_name, ''), wms.profiles.full_name);
  insert into wms.memberships (organization_id, user_id, all_warehouses, invited_by)
  values (p_org, p_user_id, coalesce(p_all_warehouses, false), v_uid)
  on conflict (organization_id, user_id) do update set all_warehouses = excluded.all_warehouses
  returning id into v_m;
  delete from wms.membership_roles where membership_id = v_m;
  insert into wms.membership_roles (membership_id, role_code) select v_m, unnest(p_roles);
  delete from wms.warehouse_access where membership_id = v_m;
  foreach v_wh in array coalesce(p_warehouses, '{}') loop
    insert into wms.warehouse_access (organization_id, membership_id, warehouse_id) values (p_org, v_m, v_wh);
  end loop;
  perform wms._audit(p_org, null, 'member_saved', 'membership', v_m::text,
    jsonb_build_object('user_id', p_user_id, 'roles', p_roles, 'all_warehouses', p_all_warehouses, 'warehouses', p_warehouses));
  return jsonb_build_object('membership_id', v_m);
exception when foreign_key_violation then
  raise exception using errcode = 'WA422', message = 'Armazém inválido para esta empresa.';
end;
$$;

create or replace function wms.set_member_active(p_membership uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_m wms.memberships; v_uid uuid;
begin
  select * into v_m from wms.memberships where id = p_membership;
  if not found then raise exception using errcode = 'WA404', message = 'Vínculo não encontrado.'; end if;
  v_uid := wms.require(v_m.organization_id, 'users.manage');
  if v_m.user_id = v_uid and not p_active then
    raise exception using errcode = 'WA409', message = 'Você não pode desativar o próprio acesso.';
  end if;
  update wms.memberships set active = p_active, deactivated_at = case when p_active then null else now() end
   where id = p_membership;
  -- Tarefas atribuídas a quem foi desativado voltam para a fila
  if not p_active then
    update wms.picking_tasks set assigned_to = null, version = version + 1
     where organization_id = v_m.organization_id and assigned_to = v_m.user_id and status in ('open', 'in_progress');
  end if;
  perform wms._audit(v_m.organization_id, null, case when p_active then 'member_reactivated' else 'member_deactivated' end,
                     'membership', p_membership::text, jsonb_build_object('user_id', v_m.user_id));
  return jsonb_build_object('membership_id', p_membership, 'active', p_active);
end;
$$;
