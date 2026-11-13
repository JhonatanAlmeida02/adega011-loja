-- Subcategorias (um nível): ex.: Destilados › Vodka, Gin, Whisky.
--
-- Uma categoria pode ficar "dentro de" outra categoria principal. Na vitrine a
-- principal vira a seção e as subcategorias aparecem como subtítulos dentro
-- dela. Só um nível: subcategoria não tem subcategorias. Excluir a principal
-- devolve as subcategorias para o topo (on delete set null).

alter table public.categorias
  add column if not exists pai_id uuid references public.categorias(id) on delete set null;
create index if not exists categorias_pai_id_idx on public.categorias(pai_id);

create or replace function privado.validar_subcategoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pai_id is null then return new; end if;
  if new.pai_id = new.id then
    raise exception 'Uma categoria não pode ficar dentro dela mesma.';
  end if;
  if exists (select 1 from public.categorias c where c.id = new.pai_id and c.pai_id is not null) then
    raise exception 'Escolha uma categoria principal. Uma subcategoria não pode ter subcategorias.';
  end if;
  if exists (select 1 from public.categorias c where c.pai_id = new.id) then
    raise exception 'Esta categoria tem subcategorias. Tire as subcategorias dela antes de colocá-la dentro de outra.';
  end if;
  return new;
end;
$$;
revoke all on function privado.validar_subcategoria() from public, anon, authenticated;

drop trigger if exists categorias_subcategoria on public.categorias;
create trigger categorias_subcategoria
  before insert or update of pai_id on public.categorias
  for each row execute function privado.validar_subcategoria();

notify pgrst, 'reload schema';
