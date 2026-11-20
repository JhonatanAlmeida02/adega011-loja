-- Catálogo exportado: ordem própria das categorias (não muda a ordem da loja).
-- Lista de slugs; as categorias que não estiverem nela vão para o fim, na ordem da loja.

alter table public.catalogo_tema add column if not exists ordem_categorias text[];

/** Salva a ordem das categorias do catálogo. Lista vazia ou null volta para a ordem da loja. */
create or replace function public.salvar_ordem_catalogo(p_ordem text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_ordem is not null and (cardinality(p_ordem) > 300
     or exists (select 1 from unnest(p_ordem) s where s is null or s !~ '^[a-z0-9-]{1,100}$')) then
    raise exception 'Ordem de categorias inválida.';
  end if;
  insert into public.catalogo_tema (id) values (1) on conflict do nothing;
  update public.catalogo_tema
     set ordem_categorias = case when cardinality(p_ordem) > 0 then p_ordem end, atualizado_em = now()
   where id = 1;
end;
$$;
revoke all on function public.salvar_ordem_catalogo(text[]) from public, anon;
grant execute on function public.salvar_ordem_catalogo(text[]) to authenticated;

notify pgrst, 'reload schema';
