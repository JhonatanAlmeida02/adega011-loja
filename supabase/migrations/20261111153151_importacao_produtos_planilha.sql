alter table public.produtos add column preco_pendente boolean not null default false;

-- Source codes and costs are internal administrative data.
create table public.produto_importacao (
  produto_id uuid primary key references public.produtos(id) on delete cascade,
  codigo text not null unique check(char_length(codigo) between 1 and 100),
  codigo_pai text,
  custo integer check(custo>=0),
  origem jsonb not null
);
alter table public.produto_importacao enable row level security;
revoke all on public.produto_importacao from public,anon,authenticated;
grant select on public.produto_importacao to authenticated;
create policy produto_importacao_admin on public.produto_importacao for select to authenticated using ((select public.is_admin()));
create function privado.proteger_preco_pendente() returns trigger language plpgsql set search_path='' as $$
begin
 if new.preco_pendente then new.disponivel:=false;end if;
 return new;
end;$$;
create trigger produtos_preco_pendente before insert or update on public.produtos for each row execute function privado.proteger_preco_pendente();
revoke all on function privado.proteger_preco_pendente() from public,anon,authenticated;
notify pgrst,'reload schema';
