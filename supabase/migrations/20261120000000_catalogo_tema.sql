-- Design do catálogo exportado (Painel › Exportar catálogo).
-- Guarda o design importado do Figma e qual usar: o padrão ou o do Figma.
-- O tema é só aparência (cores, fontes, tamanhos e imagens do Storage);
-- o banco confere o formato de cada valor antes de salvar.

create table public.catalogo_tema (
  id integer primary key default 1 check (id = 1),
  usar_figma boolean not null default false,
  tema jsonb,
  figma_link text check (figma_link is null or char_length(figma_link) <= 500),
  atualizado_em timestamptz not null default now()
);
insert into public.catalogo_tema (id) values (1) on conflict do nothing;

alter table public.catalogo_tema enable row level security;
revoke all on public.catalogo_tema from public, anon, authenticated;
grant select on public.catalogo_tema to authenticated;
create policy catalogo_tema_admin_le on public.catalogo_tema for select to authenticated using ((select public.is_admin()));

/** Valida o tema: só chaves conhecidas, cores #rrggbb, fontes simples, números em faixa e imagens do Storage. */
create or replace function privado.tema_catalogo_valido(p_tema jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  chave text;
  valor jsonb;
  sub text;
  v jsonb;
begin
  if p_tema is null or jsonb_typeof(p_tema) <> 'object' or octet_length(p_tema::text) > 8000 then return false; end if;
  for chave, valor in select * from jsonb_each(p_tema) loop
    if chave in ('fundo', 'destaque') then
      if jsonb_typeof(valor) <> 'string' or valor #>> '{}' !~ '^#[0-9a-f]{6}$' then return false; end if;
    elsif chave in ('fundoImagem', 'logo') then
      if jsonb_typeof(valor) <> 'null' and (jsonb_typeof(valor) <> 'string'
         or valor #>> '{}' !~ '^https?://[a-z0-9.:-]+/storage/v1/object/public/produtos/catalogo/[a-z0-9-]+\.(png|jpe?g|webp)$') then
        return false;
      end if;
    elsif chave in ('titulo', 'subtitulo', 'contato', 'categoria', 'subcategoria', 'cartao', 'nome', 'descricao', 'preco', 'variacoes', 'rodape') then
      if jsonb_typeof(valor) <> 'object' then return false; end if;
      for sub, v in select * from jsonb_each(valor) loop
        if sub in ('cor', 'fundo', 'marca', 'borda', 'fotoFundo') then
          if jsonb_typeof(v) <> 'string' or v #>> '{}' !~ '^#[0-9a-f]{6}$' then return false; end if;
        elsif sub = 'fonte' then
          if jsonb_typeof(v) <> 'string' or v #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$' then return false; end if;
        elsif sub = 'peso' then
          if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 100 and 900 then return false; end if;
        elsif sub = 'tamanho' then
          if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 6 and 72 then return false; end if;
        elsif sub = 'raio' then
          if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 40 then return false; end if;
        else
          return false;
        end if;
      end loop;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function privado.tema_catalogo_valido(jsonb) from public, anon, authenticated;

/**
 * Salva o design. p_tema null mantém o importado antes (só troca padrão/Figma).
 * Para usar o do Figma é preciso ter um importado.
 */
create or replace function public.salvar_tema_catalogo(p_usar_figma boolean, p_tema jsonb default null, p_figma_link text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_tema is not null and not privado.tema_catalogo_valido(p_tema) then
    raise exception 'Design inválido. Importe de novo a folha do Figma.';
  end if;
  if p_figma_link is not null and (char_length(p_figma_link) > 500 or p_figma_link !~ '^https://([a-z0-9-]+\.)?figma\.com/') then
    raise exception 'Link do Figma inválido.';
  end if;
  insert into public.catalogo_tema (id) values (1) on conflict do nothing;
  update public.catalogo_tema
     set tema = coalesce(p_tema, tema),
         figma_link = case when p_tema is not null then p_figma_link else figma_link end,
         usar_figma = coalesce(p_usar_figma, false),
         atualizado_em = now()
   where id = 1;
  if coalesce(p_usar_figma, false) and (select tema from public.catalogo_tema where id = 1) is null then
    raise exception 'Importe um design do Figma antes de usá-lo.';
  end if;
end;
$$;
revoke all on function public.salvar_tema_catalogo(boolean, jsonb, text) from public, anon;
grant execute on function public.salvar_tema_catalogo(boolean, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
