-- Maquininhas e taxa do Pix (tarifa gravada na venda, financeiro pelo valor
-- líquido, relatório) e custo automático do kit pela soma dos componentes.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/maquininhas_custo_kit.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  admin_id uuid := (select user_id from public.admins where papel = 'admin' limit 1);
  stone uuid := gen_random_uuid(); cielo uuid := gen_random_uuid();
  produto uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  kit uuid := gen_random_uuid(); grupo uuid := gen_random_uuid();
  r jsonb; v_id uuid; site uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  rel_antes jsonb; rel jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  update public.caixas set fechado_em = now() where fechado_em is null;
  if not exists (select 1 from public.financeiro_contas where padrao and ativa) then
    perform public.financeiro_salvar_conta(gen_random_uuid(), 'QA Conta', 'banco', true, true, 0);
  end if;
  rel_antes := public.relatorio_vendas(hoje, hoje);
  insert into public.produtos (id, nome, preco, ativo, disponivel, controla_estoque) values (produto, 'QA Produto 100', 10000, true, true, false);

  -- Cadastro: Stone débito 1,37% / crédito 10% (padrão no PDV e no site); Cielo 2% / 2,99% vira a padrão do PDV
  perform public.salvar_maquininha(stone, 'Stone', 137, 1000, true, true, true);
  perform public.salvar_maquininha(cielo, 'Cielo', 200, 299, true, false, true);
  if (select padrao_pdv::text || padrao_site::text from public.maquininhas where id = stone) <> 'falsetrue'
     or not (select padrao_pdv from public.maquininhas where id = cielo) then raise exception 'FAIL padrões PDV/site'; end if;
  begin
    perform public.salvar_maquininha(gen_random_uuid(), 'stone ', 100, 100, false, false, true);
    raise exception using errcode = 'XX000', message = 'FAIL nome repetido';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.salvar_maquininha(gen_random_uuid(), 'X', 100, 10001, false, false, true);
    raise exception using errcode = 'XX000', message = 'FAIL taxa acima de 100%';
  exception when sqlstate 'P0001' or check_violation then null; end;
  perform public.salvar_taxa_pix(99);
  r := public.tarifas_pagamento();
  if (r ->> 'pix_bp')::int <> 99 or jsonb_array_length(r -> 'maquininhas') <> 2
     or r #>> '{maquininhas,0,nome}' <> 'Cielo' or (r #>> '{maquininhas,0,taxa_debito_bp}')::int <> 200 then raise exception 'FAIL tarifas_pagamento: %', r; end if;

  -- PDV: Cielo no crédito (2,99%): R$ 100 → tarifa R$ 2,99, entra R$ 97,01
  perform public.abrir_caixa(0);
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao', 0, null, null, cielo, 'credito');
  v_id := (r ->> 'id')::uuid;
  if (r ->> 'tarifa')::int <> 299 or r ->> 'maquininha' <> 'Cielo (crédito)' then raise exception 'FAIL tarifa no retorno: %', r; end if;
  if (select valor from public.financeiro_vendas where pedido_id = v_id) <> 9701 then raise exception 'FAIL financeiro líquido'; end if;
  if (select descricao from public.financeiro_lancamentos where pedido_id = v_id and tipo = 'venda') not like '%tarifa Cielo (crédito) R$ 2,99%' then raise exception 'FAIL descrição'; end if;
  -- Débito sem escolher a maquininha: a padrão do PDV (Cielo) no débito, 2% → entra R$ 98,00
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao', 0, null, null, null, 'debito');
  if (select tarifa || '|' || maquininha_nome || '|' || cartao_tipo from public.pedidos where id = (r ->> 'id')::uuid) <> '200|Cielo (débito)|debito' then raise exception 'FAIL débito padrão PDV'; end if;
  if (select valor from public.financeiro_vendas where pedido_id = (r ->> 'id')::uuid) <> 9800 then raise exception 'FAIL R$ 98'; end if;
  -- Sem informar débito/crédito: crédito
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao');
  if (select tarifa from public.pedidos where id = (r ->> 'id')::uuid) <> 299 then raise exception 'FAIL crédito por padrão'; end if;
  -- Pix 0,99% e dinheiro sem taxa
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 2)), 'pix');
  if (select tarifa::text || coalesce(cartao_tipo, '-') from public.pedidos where id = (r ->> 'id')::uuid) <> '198-' then raise exception 'FAIL pix'; end if;
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'dinheiro', 0, 10000);
  if (select tarifa from public.pedidos where id = (r ->> 'id')::uuid) <> 0 then raise exception 'FAIL dinheiro'; end if;
  -- Maquininha e débito/crédito só no cartão; débito/crédito válido
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'pix', 0, null, null, cielo);
    raise exception using errcode = 'XX000', message = 'FAIL maquininha no pix';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'dinheiro', 0, null, null, null, 'debito');
    raise exception using errcode = 'XX000', message = 'FAIL débito no dinheiro';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao', 0, null, null, cielo, 'parcelado');
    raise exception using errcode = 'XX000', message = 'FAIL tipo inválido';
  exception when sqlstate 'P0001' then null; end;
  -- Cielo inativa: deixa de ser padrão e não vende; sem padrão no PDV vale a padrão do site (Stone crédito 10%)
  perform public.salvar_maquininha(cielo, 'Cielo', 200, 299, true, false, false);
  if (select padrao_pdv from public.maquininhas where id = cielo) then raise exception 'FAIL inativa padrão'; end if;
  begin
    perform public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao', 0, null, null, cielo, 'credito');
    raise exception using errcode = 'XX000', message = 'FAIL maquininha inativa';
  exception when sqlstate 'P0001' then null; end;
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao', 0, null, null, null, 'credito');
  if (select tarifa || '|' || maquininha_nome from public.pedidos where id = (r ->> 'id')::uuid) <> '1000|Stone (crédito)' then raise exception 'FAIL padrão site no PDV'; end if;

  -- Mudar a taxa depois não muda a venda antiga; mudar o total mantém a % da venda
  perform public.salvar_maquininha(stone, 'Stone', 137, 500, false, true, true);
  if (select tarifa from public.pedidos where id = v_id) <> 299 then raise exception 'FAIL venda antiga mudou'; end if;
  update public.pedidos set total = 20000 where id = v_id;
  if (select tarifa || '|' || tarifa_bp from public.pedidos where id = v_id) <> '598|299' then raise exception 'FAIL total alterado'; end if;
  if (select valor from public.financeiro_vendas where pedido_id = v_id) <> 19402 then raise exception 'FAIL financeiro após mudar total'; end if;
  -- Cancelar estorna o líquido
  update public.pedidos set status = 'cancelado' where id = v_id;
  if exists (select 1 from public.financeiro_vendas where pedido_id = v_id)
     or (select string_agg(valor::text, ',' order by valor) from public.financeiro_lancamentos where pedido_id = v_id and tipo = 'estorno_venda') <> '9701,19402'
     or (select string_agg(valor::text, ',' order by valor) from public.financeiro_lancamentos where pedido_id = v_id and tipo = 'venda') <> '9701,19402'
    then raise exception 'FAIL estorno líquido'; end if;

  -- Pedido do site pago no cartão: ao concluir usa a padrão do site (Stone) no crédito, agora 5%
  insert into public.pedidos (cliente_nome, cliente_telefone, tipo, pagamento, itens, subtotal, total, origem, status)
  values ('QA', '11999999999', 'retirada', 'cartao', '[]', 5000, 5000, 'site', 'novo') returning id into site;
  if (select tarifa from public.pedidos where id = site) <> 0 then raise exception 'FAIL tarifa antes de concluir'; end if;
  update public.pedidos set status = 'concluido' where id = site;
  if (select tarifa || '|' || maquininha_nome || '|' || cartao_tipo from public.pedidos where id = site) <> '250|Stone (crédito)|credito' then raise exception 'FAIL site'; end if;

  -- Relatório: tarifas saem do lucro (a venda cancelada não conta)
  rel := public.relatorio_vendas(hoje, hoje);
  if (rel ->> 'tarifas')::int - (rel_antes ->> 'tarifas')::int <> 200 + 299 + 198 + 1000 + 250 then raise exception 'FAIL relatório tarifas: %', rel ->> 'tarifas'; end if;
  if (rel ->> 'lucro_liquido')::bigint <> (rel ->> 'faturamento')::bigint - (rel ->> 'custo_produtos')::bigint - (rel ->> 'tarifas')::bigint - (rel ->> 'despesas')::bigint then raise exception 'FAIL lucro líquido'; end if;
  if not exists (select 1 from jsonb_array_elements(rel -> 'tarifas_por_forma') e where e ->> 'chave' = 'Cielo (débito)') then raise exception 'FAIL tarifas por forma'; end if;

  -- Custo automático do kit: A (R$ 3,00/un) × 2 + B (R$ 50,00 por 1000 ml) × 50 ml = 6,00 + 2,50
  insert into public.produtos (id, nome, preco, controla_estoque, estoque) values (a, 'QA A', 1, true, 100), (c, 'QA C', 1, true, 100), (d, 'QA D', 1, true, 100);
  insert into public.produtos (id, nome, preco, unidade_estoque, volume_unidade, controla_estoque, estoque) values (b, 'QA B', 1, 'ml', 1000, true, 10000);
  insert into public.produto_importacao (produto_id, codigo, custo, origem) values
    (a, 'QA-A-' || a, 300, '{}'), (b, 'QA-B-' || b, 5000, '{}'), (c, 'QA-C-' || c, 100, '{}');   -- D sem custo
  insert into public.produtos (id, nome, preco, eh_kit) values (kit, 'QA Kit', 2000, true);
  insert into public.kit_componentes (kit_id, componente_id, quantidade) values (kit, a, 2), (kit, b, 50);
  insert into public.produto_importacao (produto_id, codigo, custo, origem) values (kit, 'QA-K-' || kit, 9999, '{}'); -- manual: ignorado
  if (select custo_min || '|' || custo_max from public.custos_kits() where produto_id = kit) <> '850|850' then raise exception 'FAIL soma simples'; end if;
  -- Escolha obrigatória: C (R$ 1,00) ou D (sem custo, 1 un): faixa e aviso
  insert into public.grupos_opcoes (id, produto_id, nome, minimo, maximo) values (grupo, kit, 'Bebida', 1, 1);
  insert into public.opcoes (grupo_id, nome, componente_id, quantidade_consumo) values (grupo, 'C', c, 1), (grupo, 'D', d, 1);
  r := (select to_jsonb(k) from public.custos_kits() k where produto_id = kit);
  if (r ->> 'custo_min')::int <> 950 or (r ->> 'custo_max')::int <> 950 or r -> 'faltam' <> '["QA D"]'::jsonb then raise exception 'FAIL escolha sem custo: %', r; end if;
  -- Kit só com componente sem custo: custo desconhecido ("—"), não R$ 0,00
  r := public.custo_kit_previa(gen_random_uuid(), jsonb_build_array(jsonb_build_object('componente_id', d, 'quantidade', 2)));
  if r -> 'minimo' <> 'null'::jsonb or r -> 'faltam' <> '["QA D"]'::jsonb then raise exception 'FAIL sem custo nenhum: %', r; end if;
  insert into public.produto_importacao (produto_id, codigo, custo, origem) values (d, 'QA-D-' || d, 400, '{}');
  if (select custo_min || '|' || custo_max || '|' || faltam from public.custos_kits() where produto_id = kit) <> '950|1250|[]' then raise exception 'FAIL faixa'; end if;
  -- Prévia do cadastro com a composição que está na tela (3 × A, linha vazia ignorada)
  r := public.custo_kit_previa(kit, '[{"componente_id":"","quantidade":1}]'::jsonb || jsonb_build_array(jsonb_build_object('componente_id', a, 'quantidade', 3)));
  if (r ->> 'minimo')::int <> 1000 or (r ->> 'maximo')::int <> 1300 then raise exception 'FAIL prévia: %', r; end if;
  -- Relatório: kit vendido usa a soma (não o custo manual 99,99) + a escolha de verdade (D = 4,00)
  rel_antes := public.relatorio_vendas(hoje, hoje);
  update public.produtos set ativo = true, disponivel = true where id = kit;
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', kit, 'quantidade', 1,
         'opcoes', jsonb_build_array((select id from public.opcoes where grupo_id = grupo and nome = 'D')))), 'dinheiro');
  rel := public.relatorio_vendas(hoje, hoje);
  if (rel ->> 'custo_produtos')::int - (rel_antes ->> 'custo_produtos')::int <> 850 + 400 then
    raise exception 'FAIL custo do kit no relatório: %', (rel ->> 'custo_produtos')::int - (rel_antes ->> 'custo_produtos')::int; end if;

  -- Operador: vê as taxas no PDV, não cadastra
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op.taxas@adega.local', '', now(), now(), now(), '{}', '{}');
  insert into public.admins (user_id, papel, nome) values ('00000000-0000-4000-8000-0000000000cc', 'operador', 'Op');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000cc","role":"authenticated"}', true);
  perform public.tarifas_pagamento();
  begin
    perform public.salvar_maquininha(gen_random_uuid(), 'Op', 0, 0, false, false, true);
    raise exception using errcode = 'XX000', message = 'FAIL operador cadastrou maquininha';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform * from public.custos_kits();
    raise exception using errcode = 'XX000', message = 'FAIL operador viu custo';
  exception when sqlstate 'P0001' then null; end;
end;
$test$;
rollback;
select 'PASS: maquininhas com taxa de débito e crédito, padrão no PDV e no site, Pix com %, tarifa gravada na venda, financeiro líquido (R$ 100 a 10% = R$ 90), estorno, relatório sem as tarifas no lucro; custo do kit = soma dos componentes, com faixa nas escolhas e aviso de custo faltando. Dados desfeitos.' as resultado;
