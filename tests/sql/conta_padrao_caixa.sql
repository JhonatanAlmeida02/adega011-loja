-- Conta padrão do caixa: venda em dinheiro entra nela; Pix e cartão na padrão para vendas.
-- Rode em um banco de teste: psql -v ON_ERROR_STOP=1 -f tests/sql/conta_padrao_caixa.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  admin_id uuid := (select user_id from public.admins where papel = 'admin' limit 1);
  banco uuid := gen_random_uuid(); gaveta uuid := gen_random_uuid(); outra uuid := gen_random_uuid();
  produto uuid := gen_random_uuid();
  r jsonb; site uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  update public.caixas set fechado_em = now() where fechado_em is null;
  update public.financeiro_config set taxa_pix_bp = 0 where id = 1;
  delete from public.maquininhas;
  perform public.financeiro_salvar_conta(banco, 'QA Banco', 'banco', true, true, 0);
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta', 'caixa', false, true, 0, true);
  if not (select padrao_caixa from public.financeiro_saldos where id = gaveta) then raise exception 'FAIL marcar caixa'; end if;
  -- Editar pela tela antiga (sem o parâmetro) mantém a marcação
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta 2', 'caixa', false, true, 0);
  if not (select padrao_caixa from public.financeiro_contas where id = gaveta) then raise exception 'FAIL manter caixa'; end if;
  -- Só uma conta do caixa; e ela precisa estar ativa
  perform public.financeiro_salvar_conta(outra, 'QA Outra', 'caixa', false, true, 0, true);
  if (select count(*) from public.financeiro_contas where padrao_caixa) <> 1 or (select padrao_caixa from public.financeiro_contas where id = gaveta) then raise exception 'FAIL uma só'; end if;
  begin
    perform public.financeiro_salvar_conta(outra, 'QA Outra', 'caixa', false, false, 0);
    raise exception using errcode = 'XX000', message = 'FAIL desativou a conta do caixa';
  exception when sqlstate 'P0001' then null; end;
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta', 'caixa', false, true, 0, true);

  insert into public.produtos (id, nome, preco, ativo, disponivel, controla_estoque) values (produto, 'QA Produto 50', 5000, true, true, false);
  perform public.abrir_caixa(0);
  -- Dinheiro no PDV → gaveta
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'dinheiro', 0, 5000);
  if (select conta_id from public.financeiro_vendas where pedido_id = (r ->> 'id')::uuid) <> gaveta then raise exception 'FAIL dinheiro no caixa'; end if;
  -- Pix e cartão → conta padrão para vendas
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'pix');
  if (select conta_id from public.financeiro_vendas where pedido_id = (r ->> 'id')::uuid) <> banco then raise exception 'FAIL pix no banco'; end if;
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'cartao');
  if (select conta_id from public.financeiro_vendas where pedido_id = (r ->> 'id')::uuid) <> banco then raise exception 'FAIL cartão no banco'; end if;
  -- Pedido do site pago em dinheiro na entrega → gaveta
  insert into public.pedidos (cliente_nome, cliente_telefone, tipo, pagamento, itens, subtotal, total, origem, status)
  values ('QA', '11999999999', 'retirada', 'dinheiro', '[]', 3000, 3000, 'site', 'novo') returning id into site;
  update public.pedidos set status = 'concluido' where id = site;
  if (select conta_id from public.financeiro_vendas where pedido_id = site) <> gaveta then raise exception 'FAIL site em dinheiro'; end if;
  -- Sem conta do caixa: dinheiro volta a ir para a padrão
  perform public.financeiro_salvar_conta(gaveta, 'QA Gaveta', 'caixa', false, true, 0, false);
  r := public.registrar_venda_balcao(jsonb_build_array(jsonb_build_object('produto_id', produto, 'quantidade', 1)), 'dinheiro', 0, 5000);
  if (select conta_id from public.financeiro_vendas where pedido_id = (r ->> 'id')::uuid) <> banco then raise exception 'FAIL sem conta do caixa'; end if;
  if (select saldo from public.financeiro_saldos where id = gaveta) <> 8000 then raise exception 'FAIL saldo da gaveta'; end if;
end;
$test$;
rollback;
select 'PASS: venda em dinheiro (PDV e site) entra na conta do caixa; Pix e cartão na padrão; uma conta do caixa só, ativa; sem ela, tudo na padrão. Dados desfeitos.' as resultado;
