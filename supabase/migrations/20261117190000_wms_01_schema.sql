-- =====================================================================
-- WMS · 01 · Tabelas, chaves e índices
-- Schema separado (`wms`) para não misturar com a loja (`public`).
-- Regras:
--  * UUID interno; IDs externos (Olist) como texto.
--  * SKU, GTIN e códigos de barras como texto (preserva zeros à esquerda).
--  * Quantidades em numeric (nunca float); timestamps em timestamptz (UTC).
--  * organization_id em toda tabela de domínio; chaves estrangeiras compostas
--    (organization_id, id) impedem referência cruzada entre empresas.
-- O schema não é exposto pelo PostgREST: o acesso é feito pelo backend do WMS
-- (conexão transacional com o contexto do usuário) e pelo worker.
-- =====================================================================

create schema if not exists wms;
revoke all on schema wms from public;

-- ---------------------------------------------------------------------
-- Empresa, armazéns e identidade
-- ---------------------------------------------------------------------
create table if not exists wms.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- MFA obrigatório para permissões críticas (administração e aprovações)
  require_mfa boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table if not exists wms.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'inactive')),
  -- Saída física exige nota autorizada no ERP (liberação fiscal)
  require_fiscal_release boolean not null default true,
  -- Expedição parcial fica desabilitada até validar contrato e regra operacional
  partial_dispatch_enabled boolean not null default false check (partial_dispatch_enabled = false),
  -- Endereços padrão (preenchidos ao cadastrar os endereços)
  receiving_location_id uuid,
  staging_location_id uuid,
  quarantine_location_id uuid,
  returns_location_id uuid,
  transit_location_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table if not exists wms.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists wms.roles (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  name text not null,
  description text not null default ''
);

create table if not exists wms.permissions (
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null,
  requires_mfa boolean not null default false
);

create table if not exists wms.role_permissions (
  role_code text not null references wms.roles (code) on delete cascade,
  permission_code text not null references wms.permissions (code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists wms.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  user_id uuid not null references wms.profiles (user_id),
  active boolean not null default true,
  all_warehouses boolean not null default false,
  invited_by uuid,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  unique (organization_id, user_id),
  unique (organization_id, id)
);
create index if not exists memberships_user_idx on wms.memberships (user_id) where active;

create table if not exists wms.membership_roles (
  membership_id uuid not null references wms.memberships (id) on delete cascade,
  role_code text not null references wms.roles (code),
  primary key (membership_id, role_code)
);

create table if not exists wms.warehouse_access (
  organization_id uuid not null,
  membership_id uuid not null,
  warehouse_id uuid not null,
  primary key (membership_id, warehouse_id),
  foreign key (organization_id, membership_id) references wms.memberships (organization_id, id) on delete cascade,
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Cadastros: produtos, unidades, códigos, kits
-- ---------------------------------------------------------------------
create table if not exists wms.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  sku text not null check (char_length(sku) between 1 and 60),
  description text not null check (char_length(description) between 1 and 200),
  gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  base_unit text not null default 'UN' check (base_unit ~ '^[A-Z0-9]{1,6}$'),
  lot_control boolean not null default false,
  expiry_control boolean not null default false,
  serial_control boolean not null default false,
  min_shelf_days integer not null default 0 check (min_shelf_days between 0 and 3650),
  -- Kit: 'components' reserva os componentes; 'assembled' trata o kit montado como item próprio.
  kit_policy text not null default 'none' check (kit_policy in ('none', 'components', 'assembled')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  image_url text check (image_url is null or image_url ~ '^https://'),
  preferred_zone_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku),
  unique (organization_id, id),
  check (not expiry_control or lot_control)
);

create table if not exists wms.product_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]{1,10}$'),
  factor numeric(18, 6) not null check (factor > 0),
  created_at timestamptz not null default now(),
  unique (product_id, code),
  unique (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id) on delete cascade
);

create table if not exists wms.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  unit_id uuid,
  barcode text not null check (barcode ~ '^[0-9A-Za-z.\-/+]{1,64}$'),
  created_at timestamptz not null default now(),
  -- O mesmo código pode existir em produtos diferentes (ex.: código de fornecedor):
  -- a leitura resolve e, se houver mais de um, exige escolha explícita.
  unique (product_id, barcode),
  foreign key (organization_id, product_id) references wms.products (organization_id, id) on delete cascade,
  foreign key (organization_id, unit_id) references wms.product_units (organization_id, id) on delete cascade
);
create index if not exists product_barcodes_lookup_idx on wms.product_barcodes (organization_id, barcode);

create table if not exists wms.kit_components (
  organization_id uuid not null,
  kit_product_id uuid not null,
  component_product_id uuid not null,
  quantity numeric(18, 6) not null check (quantity > 0),
  primary key (kit_product_id, component_product_id),
  check (kit_product_id <> component_product_id),
  foreign key (organization_id, kit_product_id) references wms.products (organization_id, id) on delete cascade,
  foreign key (organization_id, component_product_id) references wms.products (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Endereçamento
-- ---------------------------------------------------------------------
create table if not exists wms.warehouse_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name text not null default '',
  unique (warehouse_id, code),
  unique (organization_id, id),
  unique (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);

create table if not exists wms.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  zone_id uuid,
  code text not null check (code ~ '^[A-Z0-9_.-]{1,30}$'),
  type text not null check (type in ('receiving', 'storage', 'picking', 'staging', 'packing', 'dock', 'quarantine', 'returns', 'transit')),
  -- Separação só reserva em endereços marcados como pickable
  pickable boolean not null default false,
  capacity_units numeric(18, 6) check (capacity_units is null or capacity_units > 0),
  blocked boolean not null default false,
  block_reason text,
  -- Inventário ativo: movimentação e reserva bloqueadas
  counting_session_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code),
  unique (organization_id, id),
  unique (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, warehouse_id, zone_id) references wms.warehouse_zones (organization_id, warehouse_id, id),
  check (not (pickable and type in ('quarantine', 'transit', 'returns', 'dock', 'staging', 'packing')))
);
create index if not exists locations_wh_idx on wms.locations (warehouse_id, type);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'warehouses_receiving_fk') then
    alter table wms.warehouses
      add constraint warehouses_receiving_fk foreign key (organization_id, id, receiving_location_id) references wms.locations (organization_id, warehouse_id, id),
      add constraint warehouses_staging_fk foreign key (organization_id, id, staging_location_id) references wms.locations (organization_id, warehouse_id, id),
      add constraint warehouses_quarantine_fk foreign key (organization_id, id, quarantine_location_id) references wms.locations (organization_id, warehouse_id, id),
      add constraint warehouses_returns_fk foreign key (organization_id, id, returns_location_id) references wms.locations (organization_id, warehouse_id, id),
      add constraint warehouses_transit_fk foreign key (organization_id, id, transit_location_id) references wms.locations (organization_id, warehouse_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_zone_fk') then
    alter table wms.products add constraint products_zone_fk foreign key (organization_id, preferred_zone_id) references wms.warehouse_zones (organization_id, id);
  end if;
end $$;

-- Mínimo/máximo do endereço de picking (reabastecimento)
create table if not exists wms.location_products (
  organization_id uuid not null,
  warehouse_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  min_qty numeric(18, 6) not null check (min_qty >= 0),
  max_qty numeric(18, 6) not null check (max_qty > 0),
  primary key (location_id, product_id),
  check (max_qty >= min_qty),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Lotes, séries e unidades logísticas
-- ---------------------------------------------------------------------
create table if not exists wms.lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  code text not null check (code ~ '^[0-9A-Za-z.\-/]{1,40}$'),
  expiry_date date,
  created_at timestamptz not null default now(),
  unique (product_id, code),
  unique (organization_id, id),
  unique (organization_id, product_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

create table if not exists wms.serial_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  serial text not null check (serial ~ '^[0-9A-Za-z.\-/]{1,60}$'),
  lot_id uuid,
  -- Posição atual: uma série nunca está em duas posições (coluna única)
  location_id uuid,
  condition text,
  status text not null default 'registered' check (status in ('registered', 'in_stock', 'dispatched', 'scrapped', 'returned_to_supplier')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, serial),
  unique (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id),
  foreign key (organization_id, location_id) references wms.locations (organization_id, id),
  check ((location_id is null) = (condition is null))
);

create table if not exists wms.handling_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9_-]{3,40}$'),
  type text not null check (type in ('pallet', 'box', 'tote')),
  location_id uuid,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id)
);

-- ---------------------------------------------------------------------
-- Integração (conexões e mapeamentos vêm antes porque pedidos/recebimentos os referenciam)
-- ---------------------------------------------------------------------
create table if not exists wms.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  provider text not null default 'olist' check (provider in ('olist')),
  api_version text not null default 'v3' check (api_version in ('v3')),
  adapter text not null default 'mock' check (adapter in ('mock', 'olist_v3')),
  name text not null default 'Olist ERP',
  status text not null default 'pending_authorization'
    check (status in ('pending_authorization', 'active', 'reauthorization_required', 'paused', 'disabled')),
  status_reason text,
  -- Escritas reais no ERP ficam desligadas até a homologação interna
  write_enabled boolean not null default false,
  -- Identificador opaco usado na URL do webhook (não é segredo de autenticação)
  webhook_ref text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  -- Tokens cifrados no backend (AES-256-GCM); a chave fica fora do banco
  credentials_ciphertext text,
  credentials_key_version integer,
  credentials_version integer not null default 0,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  refresh_lease_owner text,
  refresh_lease_until timestamptz,
  -- OAuth: state + verificador PKCE (este cifrado) da autorização em andamento
  oauth_state_hash text,
  oauth_state_expires_at timestamptz,
  oauth_pkce_ciphertext text,
  oauth_started_by uuid,
  -- Status do pedido no ERP considerados elegíveis para separação (decisão de negócio)
  eligible_order_statuses text[] not null default array[]::text[],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Depósitos do ERP e o armazém WMS correspondente (mapeamento obrigatório antes da sincronização)
create table if not exists wms.erp_deposits (
  organization_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  name text not null default '',
  warehouse_id uuid,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (connection_id, external_id),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);
-- Um armazém corresponde a no máximo um depósito por conexão
create unique index if not exists erp_deposits_wh_uidx on wms.erp_deposits (connection_id, warehouse_id) where warehouse_id is not null;

-- Política de lançamento de estoque no ERP, validada por depósito (contra baixa duplicada)
create table if not exists wms.stock_posting_policies (
  organization_id uuid not null,
  connection_id uuid not null,
  warehouse_id uuid not null,
  -- Saída: 'erp_on_invoice' = o ERP baixa ao faturar/lançar o pedido e o WMS só reconhece;
  --        'wms_on_dispatch' = o WMS solicita a baixa documentada ao despachar.
  outbound_policy text not null default 'undefined' check (outbound_policy in ('undefined', 'erp_on_invoice', 'wms_on_dispatch')),
  -- Entrada: 'erp_on_document' = a nota/ordem de compra lança no ERP;
  --          'wms_on_receipt' = o WMS lança ao confirmar o recebimento.
  inbound_policy text not null default 'undefined' check (inbound_policy in ('undefined', 'erp_on_document', 'wms_on_receipt')),
  validated_at timestamptz,
  validated_by uuid,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (connection_id, warehouse_id),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);

create table if not exists wms.external_mappings (
  organization_id uuid not null,
  connection_id uuid not null,
  entity_type text not null check (entity_type in ('product', 'order', 'purchase_order', 'invoice')),
  external_id text not null,
  internal_id uuid not null,
  external_version text,
  payload_hash text,
  updated_at timestamptz not null default now(),
  primary key (connection_id, entity_type, external_id),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create index if not exists external_mappings_internal_idx on wms.external_mappings (entity_type, internal_id);

create table if not exists wms.sync_cursors (
  connection_id uuid not null references wms.integration_connections (id),
  resource text not null check (resource ~ '^[a-z_]{2,40}$'),
  cursor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (connection_id, resource)
);

-- ---------------------------------------------------------------------
-- Ledger de estoque, saldos e reservas
-- ---------------------------------------------------------------------
create table if not exists wms.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  movement_type text not null check (movement_type in (
    'receipt', 'putaway', 'transfer', 'replenishment', 'pick', 'unpick', 'dispatch',
    'inventory_adjustment', 'return_receipt', 'condition_change', 'scrap', 'supplier_return',
    'transfer_out', 'transfer_in', 'reversal')),
  reason text,
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  reverses_movement_id uuid unique references wms.stock_movements (id),
  -- Como o fato econômico chega ao ERP: 'none' (sem efeito no saldo agregado),
  -- 'erp_side' (ERP lança sozinho), 'outbox' (WMS solicita) ou 'blocked' (política não definida)
  erp_posting text not null default 'none' check (erp_posting in ('none', 'erp_side', 'outbox', 'blocked')),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);
create index if not exists stock_movements_ref_idx on wms.stock_movements (reference_type, reference_id);
create index if not exists stock_movements_wh_idx on wms.stock_movements (warehouse_id, created_at desc);

create table if not exists wms.stock_entries (
  id bigint generated always as identity primary key,
  movement_id uuid not null references wms.stock_movements (id),
  organization_id uuid not null,
  warehouse_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  serial_id uuid,
  condition text not null check (condition in ('available', 'quarantine', 'blocked', 'damaged', 'in_transit')),
  quantity numeric(18, 6) not null check (quantity <> 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id),
  foreign key (organization_id, serial_id) references wms.serial_numbers (organization_id, id)
);
create index if not exists stock_entries_movement_idx on wms.stock_entries (movement_id);
create index if not exists stock_entries_dim_idx on wms.stock_entries (product_id, location_id, lot_id);

-- Projeção: atualizada na mesma transação do ledger; pode ser reconstruída a partir de stock_entries.
create table if not exists wms.stock_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  condition text not null check (condition in ('available', 'quarantine', 'blocked', 'damaged', 'in_transit')),
  quantity numeric(18, 6) not null default 0 check (quantity >= 0),
  reserved numeric(18, 6) not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  constraint stock_balances_reserved_le_quantity check (reserved <= quantity),
  constraint stock_balances_reserved_only_available check (reserved = 0 or condition = 'available'),
  constraint stock_balances_dim_uq unique nulls not distinct (location_id, product_id, lot_id, condition),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id)
);
create index if not exists stock_balances_product_idx on wms.stock_balances (warehouse_id, product_id) where quantity > 0;

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create table if not exists wms.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  connection_id uuid,
  external_id text,
  number text not null check (char_length(number) between 1 and 60),
  customer_name text not null default '',
  -- Estados separados por domínio: execução (WMS), ERP, fiscal e integração
  status text not null default 'awaiting_allocation' check (status in (
    'awaiting_allocation', 'allocated', 'picking', 'picked', 'checking', 'packed',
    'ready_to_dispatch', 'partially_dispatched', 'dispatched', 'on_hold', 'cancelled')),
  hold_reason text,
  status_before_hold text,
  erp_status text,
  fiscal_status text not null default 'pending' check (fiscal_status in ('pending', 'released', 'cancelled', 'not_required')),
  integration_status text not null default 'synced' check (integration_status in ('synced', 'pending', 'failed')),
  external_version text,
  revision integer not null default 1,
  allocated_revision integer,
  items_hash text,
  version integer not null default 1,
  ship_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create unique index if not exists orders_external_uidx on wms.orders (connection_id, external_id) where external_id is not null;
create index if not exists orders_wh_status_idx on wms.orders (warehouse_id, status);

create table if not exists wms.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  line_no integer not null check (line_no > 0),
  -- 'kit_parent' não é separado: seus componentes viram linhas 'kit_component'
  kind text not null default 'product' check (kind in ('product', 'kit_parent', 'kit_component')),
  kit_parent_item_id uuid references wms.order_items (id),
  product_id uuid not null,
  quantity numeric(18, 6) not null check (quantity > 0),
  external_item_id text,
  -- Linha substituída por uma revisão posterior do pedido (fica como histórico)
  superseded boolean not null default false,
  unique (order_id, line_no),
  unique (organization_id, id),
  foreign key (organization_id, order_id) references wms.orders (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

create table if not exists wms.order_revisions (
  order_id uuid not null references wms.orders (id),
  revision integer not null,
  items_hash text not null,
  external_version text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (order_id, revision)
);

create table if not exists wms.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  quantity numeric(18, 6) not null check (quantity >= 0),
  -- active: no endereço de origem; staged: separado, em staging; consumed: expedido; released: liberado
  status text not null check (status in ('active', 'staged', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, warehouse_id, order_id) references wms.orders (organization_id, warehouse_id, id),
  foreign key (organization_id, order_item_id) references wms.order_items (organization_id, id),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id)
);
create unique index if not exists stock_reservations_open_uidx
  on wms.stock_reservations (order_item_id, location_id, lot_id, status) nulls not distinct
  where status in ('active', 'staged');
create index if not exists stock_reservations_order_idx on wms.stock_reservations (order_id) where status in ('active', 'staged');

-- ---------------------------------------------------------------------
-- Ondas e separação
-- ---------------------------------------------------------------------
create table if not exists wms.waves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  code text not null,
  status text not null default 'open' check (status in ('open', 'released', 'completed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);

create table if not exists wms.picking_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  order_id uuid not null,
  wave_id uuid,
  zone_id uuid,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled', 'invalidated')),
  assigned_to uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id, order_id) references wms.orders (organization_id, warehouse_id, id),
  foreign key (organization_id, wave_id) references wms.waves (organization_id, id),
  foreign key (organization_id, warehouse_id, zone_id) references wms.warehouse_zones (organization_id, warehouse_id, id)
);
create index if not exists picking_tasks_open_idx on wms.picking_tasks (warehouse_id, status) where status in ('open', 'in_progress');

create table if not exists wms.picking_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  order_item_id uuid not null,
  reservation_id uuid not null references wms.stock_reservations (id),
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  quantity numeric(18, 6) not null check (quantity > 0),
  picked_qty numeric(18, 6) not null default 0 check (picked_qty >= 0),
  short_qty numeric(18, 6) not null default 0 check (short_qty >= 0),
  status text not null default 'open' check (status in ('open', 'picked', 'short', 'cancelled')),
  check (picked_qty + short_qty <= quantity),
  foreign key (organization_id, task_id) references wms.picking_tasks (organization_id, id),
  foreign key (organization_id, order_item_id) references wms.order_items (organization_id, id),
  foreign key (organization_id, location_id) references wms.locations (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);
create index if not exists picking_items_task_idx on wms.picking_items (task_id);

-- Cada leitura intencional tem ID próprio (gerado no coletor); retentativa reutiliza o ID.
create table if not exists wms.scan_events (
  id uuid primary key,
  organization_id uuid not null references wms.organizations (id),
  warehouse_id uuid not null,
  context_type text not null,
  context_id uuid not null,
  user_id uuid,
  raw_code text not null,
  product_id uuid,
  quantity numeric(18, 6),
  created_at timestamptz not null default now()
);
create index if not exists scan_events_context_idx on wms.scan_events (context_type, context_id);
create index if not exists scan_events_user_idx on wms.scan_events (user_id, created_at);

-- ---------------------------------------------------------------------
-- Conferência, volumes e expedição
-- ---------------------------------------------------------------------
create table if not exists wms.packing_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  order_id uuid not null unique,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  started_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  version integer not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id, order_id) references wms.orders (organization_id, warehouse_id, id)
);

create table if not exists wms.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  order_id uuid not null,
  label_code text not null unique,
  status text not null default 'open' check (status in ('open', 'closed', 'voided', 'dispatched')),
  weight_kg numeric(10, 3) check (weight_kg is null or weight_kg > 0),
  length_cm numeric(10, 2) check (length_cm is null or length_cm > 0),
  width_cm numeric(10, 2) check (width_cm is null or width_cm > 0),
  height_cm numeric(10, 2) check (height_cm is null or height_cm > 0),
  label_print_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id, order_id) references wms.orders (organization_id, warehouse_id, id)
);

create table if not exists wms.package_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  package_id uuid not null,
  order_item_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  serial_id uuid unique,
  quantity numeric(18, 6) not null check (quantity > 0),
  foreign key (organization_id, package_id) references wms.packages (organization_id, id),
  foreign key (organization_id, order_item_id) references wms.order_items (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);
create unique index if not exists package_items_dim_uidx on wms.package_items (package_id, order_item_id, lot_id) nulls not distinct where serial_id is null;

create table if not exists wms.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  code text not null,
  carrier text not null default '',
  dock_location_id uuid,
  status text not null default 'open' check (status in ('open', 'loading', 'dispatched', 'cancelled')),
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  dispatched_by uuid,
  unique (warehouse_id, code),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, warehouse_id, dock_location_id) references wms.locations (organization_id, warehouse_id, id)
);

create table if not exists wms.shipment_packages (
  organization_id uuid not null,
  shipment_id uuid not null,
  package_id uuid not null unique,
  order_id uuid not null,
  loaded_at timestamptz,
  loaded_by uuid,
  primary key (shipment_id, package_id),
  foreign key (organization_id, shipment_id) references wms.shipments (organization_id, id),
  foreign key (organization_id, package_id) references wms.packages (organization_id, id)
);

create table if not exists wms.dispatch_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null,
  order_id uuid not null,
  movement_id uuid references wms.stock_movements (id),
  dispatched_by uuid,
  created_at timestamptz not null default now(),
  unique (shipment_id, order_id),
  foreign key (organization_id, shipment_id) references wms.shipments (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Recebimento e armazenagem
-- ---------------------------------------------------------------------
create table if not exists wms.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  source_type text not null check (source_type in ('erp_purchase_order', 'erp_invoice', 'manual')),
  source_ref text not null check (char_length(source_ref) between 1 and 80),
  connection_id uuid,
  supplier_name text not null default '',
  status text not null default 'expected' check (status in ('expected', 'receiving', 'awaiting_review', 'partially_received', 'received', 'cancelled')),
  quarantine_on_receipt boolean not null default false,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  -- Mesma origem não gera dois recebimentos
  unique (organization_id, source_type, source_ref),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create index if not exists receipts_wh_status_idx on wms.receipts (warehouse_id, status);

create table if not exists wms.receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  line_no integer not null check (line_no > 0),
  product_id uuid not null,
  expected_qty numeric(18, 6) not null check (expected_qty > 0),
  received_qty numeric(18, 6) not null default 0 check (received_qty >= 0),
  damaged_qty numeric(18, 6) not null default 0 check (damaged_qty >= 0),
  rejected_qty numeric(18, 6) not null default 0 check (rejected_qty >= 0),
  overage_approved_qty numeric(18, 6) not null default 0 check (overage_approved_qty >= 0),
  status text not null default 'open' check (status in ('open', 'complete', 'closed_short')),
  unique (receipt_id, line_no),
  unique (organization_id, id),
  foreign key (organization_id, receipt_id) references wms.receipts (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

create table if not exists wms.receipt_checks (
  id uuid primary key,
  organization_id uuid not null,
  receipt_id uuid not null,
  receipt_item_id uuid not null,
  product_id uuid not null,
  unit_code text not null,
  unit_factor numeric(18, 6) not null check (unit_factor > 0),
  quantity numeric(18, 6) not null check (quantity > 0),
  lot_code text,
  expiry_date date,
  serial text,
  outcome text not null check (outcome in ('accepted', 'damaged', 'rejected')),
  movement_id uuid references wms.stock_movements (id),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id) references wms.receipts (organization_id, id),
  foreign key (organization_id, receipt_item_id) references wms.receipt_items (organization_id, id)
);
create unique index if not exists receipt_checks_serial_uidx on wms.receipt_checks (receipt_id, product_id, serial) where serial is not null;

create table if not exists wms.putaway_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  kind text not null check (kind in ('putaway', 'replenishment', 'return_to_stock')),
  source_type text not null,
  source_id uuid,
  product_id uuid not null,
  lot_id uuid,
  serial_id uuid,
  condition text not null default 'available' check (condition in ('available', 'quarantine', 'blocked', 'damaged')),
  from_location_id uuid not null,
  suggested_location_id uuid,
  to_location_id uuid,
  quantity numeric(18, 6) not null check (quantity > 0),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  assigned_to uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid,
  movement_id uuid references wms.stock_movements (id),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id, from_location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id, suggested_location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id, to_location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);
create index if not exists putaway_tasks_open_idx on wms.putaway_tasks (warehouse_id, status) where status = 'open';

-- ---------------------------------------------------------------------
-- Transferências entre armazéns
-- ---------------------------------------------------------------------
create table if not exists wms.transfer_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  from_warehouse_id uuid not null,
  to_warehouse_id uuid not null,
  code text not null,
  status text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'closed_with_discrepancy', 'cancelled')),
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  shipped_at timestamptz,
  closed_at timestamptz,
  check (from_warehouse_id <> to_warehouse_id),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, from_warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, to_warehouse_id) references wms.warehouses (organization_id, id)
);

create table if not exists wms.transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  transfer_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  from_location_id uuid not null,
  quantity numeric(18, 6) not null check (quantity > 0),
  shipped_qty numeric(18, 6) not null default 0 check (shipped_qty >= 0),
  received_qty numeric(18, 6) not null default 0 check (received_qty >= 0),
  check (received_qty <= shipped_qty),
  foreign key (organization_id, transfer_id) references wms.transfer_orders (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id),
  foreign key (organization_id, from_location_id) references wms.locations (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Inventário
-- ---------------------------------------------------------------------
create table if not exists wms.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  code text not null,
  kind text not null default 'cycle' check (kind in ('cycle', 'full', 'initial_load')),
  status text not null default 'draft' check (status in ('draft', 'counting', 'review', 'closed', 'cancelled')),
  blind boolean not null default true,
  current_round integer not null default 1 check (current_round >= 1),
  max_rounds integer not null default 2 check (max_rounds between 1 and 5),
  tolerance_qty numeric(18, 6) not null default 0 check (tolerance_qty >= 0),
  tolerance_pct numeric(7, 4) not null default 0 check (tolerance_pct between 0 and 100),
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  unique (warehouse_id, code),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'locations_counting_fk') then
    alter table wms.locations add constraint locations_counting_fk
      foreign key (organization_id, counting_session_id) references wms.inventory_sessions (organization_id, id);
  end if;
end $$;

create table if not exists wms.inventory_session_locations (
  organization_id uuid not null,
  session_id uuid not null,
  location_id uuid not null,
  recount_round integer,
  primary key (session_id, location_id),
  foreign key (organization_id, session_id) references wms.inventory_sessions (organization_id, id),
  foreign key (organization_id, location_id) references wms.locations (organization_id, id)
);

create table if not exists wms.inventory_counts (
  id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  round integer not null check (round >= 1),
  counted_qty numeric(18, 6) not null check (counted_qty >= 0),
  counted_by uuid not null,
  counted_at timestamptz not null default now(),
  foreign key (organization_id, session_id) references wms.inventory_sessions (organization_id, id),
  foreign key (organization_id, location_id) references wms.locations (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id),
  foreign key (organization_id, product_id, lot_id) references wms.lots (organization_id, product_id, id)
);
create index if not exists inventory_counts_session_idx on wms.inventory_counts (session_id, round);

create table if not exists wms.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  session_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  lot_id uuid,
  condition text not null default 'available',
  expected_qty numeric(18, 6) not null,
  counted_qty numeric(18, 6) not null,
  difference numeric(18, 6) not null check (difference <> 0),
  reason text not null,
  evidence_path text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'cancelled')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  movement_id uuid references wms.stock_movements (id),
  check (decided_by is null or decided_by <> requested_by),
  unique (organization_id, id),
  foreign key (organization_id, session_id) references wms.inventory_sessions (organization_id, id),
  foreign key (organization_id, warehouse_id, location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Devoluções e qualidade
-- ---------------------------------------------------------------------
create table if not exists wms.returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  order_id uuid,
  code text not null,
  reason text not null default '',
  status text not null default 'expected' check (status in ('expected', 'receiving', 'inspection', 'closed', 'cancelled')),
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, warehouse_id) references wms.warehouses (organization_id, id),
  foreign key (organization_id, order_id) references wms.orders (organization_id, id)
);

create table if not exists wms.return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  return_id uuid not null,
  product_id uuid not null,
  expected_qty numeric(18, 6) not null check (expected_qty > 0),
  received_qty numeric(18, 6) not null default 0 check (received_qty >= 0),
  decided_qty numeric(18, 6) not null default 0 check (decided_qty >= 0),
  check (decided_qty <= received_qty),
  unique (return_id, product_id),
  unique (organization_id, id),
  foreign key (organization_id, return_id) references wms.returns (organization_id, id),
  foreign key (organization_id, product_id) references wms.products (organization_id, id)
);

create table if not exists wms.quality_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid not null,
  return_item_id uuid,
  product_id uuid not null,
  lot_id uuid,
  serial_id uuid,
  from_location_id uuid not null,
  to_location_id uuid,
  decision text not null check (decision in ('reintegrate', 'repair', 'discard', 'return_to_supplier')),
  quantity numeric(18, 6) not null check (quantity > 0),
  notes text not null default '',
  decided_by uuid not null,
  movement_id uuid references wms.stock_movements (id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, return_item_id) references wms.return_items (organization_id, id),
  foreign key (organization_id, warehouse_id, from_location_id) references wms.locations (organization_id, warehouse_id, id),
  foreign key (organization_id, warehouse_id, to_location_id) references wms.locations (organization_id, warehouse_id, id)
);

-- ---------------------------------------------------------------------
-- Fila de integração (inbox/outbox), tentativas e limites
-- ---------------------------------------------------------------------
create table if not exists wms.inbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  source text not null check (source in ('webhook', 'poll')),
  dedup_key text not null,
  event_type text not null,
  entity_external_id text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, dedup_key),
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create index if not exists inbox_pending_idx on wms.inbox_events (next_attempt_at) where status in ('pending', 'processing');

create table if not exists wms.outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  warehouse_id uuid,
  connection_id uuid,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'unknown', 'blocked', 'cancelled')),
  blocked_reason text,
  attempts integer not null default 0,
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  send_started_at timestamptz,
  needs_verification boolean not null default false,
  last_error text,
  external_ref text,
  correlation_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create index if not exists outbox_pending_idx on wms.outbox_events (next_attempt_at) where status in ('pending', 'processing');
create index if not exists outbox_aggregate_idx on wms.outbox_events (aggregate_type, aggregate_id);

create table if not exists wms.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  kind text not null check (kind in ('import_products', 'import_deposits', 'import_orders', 'import_purchase_orders', 'reconcile_stock', 'refresh_token')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  params jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id, connection_id) references wms.integration_connections (organization_id, id)
);
create unique index if not exists integration_jobs_active_uidx on wms.integration_jobs (connection_id, kind) where status in ('pending', 'running');

create table if not exists wms.integration_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  connection_id uuid,
  outbox_id uuid references wms.outbox_events (id),
  inbox_id uuid references wms.inbox_events (id),
  job_id uuid references wms.integration_jobs (id),
  operation text not null,
  outcome text not null check (outcome in ('success', 'transient_error', 'permanent_error', 'unknown', 'capability_unavailable', 'verified_applied', 'verified_not_applied')),
  http_status integer,
  error_code text,
  message text,
  response_excerpt jsonb,
  correlation_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists integration_attempts_outbox_idx on wms.integration_attempts (outbox_id);

-- Limite de requisições por CONTA (compartilhado entre processos e aplicativos)
create table if not exists wms.rate_limit_windows (
  connection_id uuid not null references wms.integration_connections (id),
  bucket text not null check (bucket in ('read', 'write')),
  window_start timestamptz not null,
  used integer not null default 0,
  limit_per_window integer not null,
  blocked_until timestamptz,
  primary key (connection_id, bucket)
);

-- ---------------------------------------------------------------------
-- Ocorrências, aprovações, idempotência e auditoria
-- ---------------------------------------------------------------------
create table if not exists wms.discrepancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  warehouse_id uuid,
  kind text not null,
  entity_type text not null,
  entity_id uuid,
  product_id uuid,
  location_id uuid,
  quantity numeric(18, 6),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text
);
create index if not exists discrepancies_open_idx on wms.discrepancies (organization_id, status) where status = 'open';

create table if not exists wms.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  warehouse_id uuid,
  kind text not null,
  entity_type text not null,
  entity_id uuid not null,
  requested_by uuid,
  decided_by uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  notes text not null default '',
  decided_at timestamptz not null default now(),
  check (requested_by is null or requested_by <> decided_by)
);

create table if not exists wms.command_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references wms.organizations (id),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,200}$'),
  command text not null,
  payload_hash text not null,
  result jsonb,
  user_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists wms.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references wms.organizations (id),
  warehouse_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_org_idx on wms.audit_events (organization_id, created_at desc);

-- Transições permitidas por domínio (fonte única; o código TypeScript espelha e é testado contra ela)
create table if not exists wms.state_transitions (
  domain text not null,
  from_state text not null,
  to_state text not null,
  primary key (domain, from_state, to_state)
);

-- ---------------------------------------------------------------------
-- Imutabilidade do ledger e da auditoria
-- ---------------------------------------------------------------------
create or replace function wms._immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'WA409',
    message = format('Registros de %s são imutáveis: corrija com um movimento inverso vinculado.', tg_table_name);
end;
$$;

drop trigger if exists stock_movements_immutable on wms.stock_movements;
create trigger stock_movements_immutable before update or delete on wms.stock_movements
  for each row execute function wms._immutable();
drop trigger if exists stock_entries_immutable on wms.stock_entries;
create trigger stock_entries_immutable before update or delete on wms.stock_entries
  for each row execute function wms._immutable();
drop trigger if exists audit_events_immutable on wms.audit_events;
create trigger audit_events_immutable before update or delete on wms.audit_events
  for each row execute function wms._immutable();
drop trigger if exists scan_events_immutable on wms.scan_events;
create trigger scan_events_immutable before update or delete on wms.scan_events
  for each row execute function wms._immutable();
