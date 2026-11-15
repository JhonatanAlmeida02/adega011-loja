-- Pix: a preparação da cobrança devolve também os itens e a taxa do pedido,
-- para a cobrança no Mercado Pago listar cada produto (quantidade e preço
-- unitário). O valor cobrado continua sendo o total do pedido.

create or replace function public.pix_preparar(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_pag public.pagamentos%rowtype;
begin
  if not coalesce((select pix_online from public.configuracoes where id = 1), false) then
    raise exception 'Pix automático desligado.';
  end if;
  select * into v_pedido from public.pedidos where id = p_pedido;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.pagamento <> 'pix' or v_pedido.origem <> 'site' then raise exception 'Este pedido não é pago por Pix.'; end if;

  -- Uma cobrança por pedido: devolve a que existe; se venceu, o cliente faz outro pedido
  select * into v_pag from public.pagamentos where pedido_id = p_pedido order by criado_em desc limit 1;
  if found then
    if v_pag.status = 'pago' or (v_pag.status = 'pendente' and v_pag.expira_em > now() + interval '2 minutes') then
      return jsonb_build_object('existente', jsonb_build_object('id_externo', v_pag.id_externo, 'status', v_pag.status));
    end if;
    raise exception 'O Pix deste pedido venceu. Faça o pedido de novo.';
  end if;

  if v_pedido.status <> 'novo' then raise exception 'Este pedido não está mais aguardando pagamento.'; end if;
  if v_pedido.criado_em < now() - interval '2 hours' then raise exception 'Pedido antigo. Faça um novo pedido.'; end if;
  if v_pedido.total <= 0 then raise exception 'Pedido sem valor.'; end if;
  return jsonb_build_object('pedido', jsonb_build_object(
    'numero', v_pedido.numero, 'total', v_pedido.total, 'cliente_nome', v_pedido.cliente_nome,
    'taxa', v_pedido.taxa, 'desconto', v_pedido.desconto, 'itens', v_pedido.itens));
end;
$$;
revoke all on function public.pix_preparar(uuid) from public, anon, authenticated;
grant execute on function public.pix_preparar(uuid) to service_role;

notify pgrst, 'reload schema';
