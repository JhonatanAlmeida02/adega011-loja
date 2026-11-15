-- Estorno do Pix automático pelo painel.
--
-- O painel chama a Edge Function "pix" (rota /pix/estornar) com o login do
-- admin. A função usa esta consulta, feita COM O LOGIN DE QUEM CLICOU: só admin
-- passa (privado.exigir_admin) e só um Pix pago pode ser estornado. O valor é
-- sempre o total cobrado; ninguém digita valor. Quem marca "estornado" é a
-- consulta ao Mercado Pago depois da devolução (public.pix_aplicar).

create or replace function public.pix_para_estorno(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pag public.pagamentos%rowtype;
begin
  perform privado.exigir_admin();
  select * into v_pag from public.pagamentos
   where pedido_id = p_pedido and status = 'pago'
   order by criado_em desc limit 1;
  if not found then raise exception 'Este pedido não tem Pix pago para estornar.'; end if;
  return jsonb_build_object('id_externo', v_pag.id_externo, 'valor', v_pag.valor);
end;
$$;
revoke all on function public.pix_para_estorno(uuid) from public, anon;
grant execute on function public.pix_para_estorno(uuid) to authenticated;

notify pgrst, 'reload schema';
