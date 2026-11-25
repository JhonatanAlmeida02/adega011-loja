-- Ordens de entrada: excluir de vez.
-- Só ordens que não mexeram no estoque (pendente ou cancelada). A lançada fica:
-- o estoque já recebeu a mercadoria e a nota é o documento dessa entrada.
-- Excluir libera a chave da NF-e: o mesmo XML pode ser importado de novo.

create or replace function public.excluir_ordem_entrada(p_id uuid, p_versao integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare situacao text;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  select status into situacao from public.ordens_entrada where id = p_id for update;
  if not found then raise exception 'Ordem não encontrada. Reabra a lista.'; end if;
  if situacao = 'lancada' then
    raise exception 'Ordem já lançada no estoque não pode ser excluída.';
  end if;
  -- Os itens saem junto (on delete cascade)
  delete from public.ordens_entrada where id = p_id and versao = p_versao and status in ('pendente', 'cancelada');
  if not found then raise exception 'A ordem mudou enquanto você olhava. Reabra a lista.'; end if;
end;
$$;
revoke all on function public.excluir_ordem_entrada(uuid, integer) from public, anon;
grant execute on function public.excluir_ordem_entrada(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
