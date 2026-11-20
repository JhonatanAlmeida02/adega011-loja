-- Catálogo: o design do Figma também guarda os elementos que o cliente adicionou
-- na folha (logo grande, marca d'água, faixas…) como "decoracoes": imagem do
-- Storage + posição e tamanho em % da folha, repetidos em todas as páginas.

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
  d jsonb;
begin
  if p_tema is null or jsonb_typeof(p_tema) <> 'object' or octet_length(p_tema::text) > 16000 then return false; end if;
  for chave, valor in select * from jsonb_each(p_tema) loop
    if chave in ('fundo', 'destaque') then
      if jsonb_typeof(valor) <> 'string' or valor #>> '{}' !~ '^#[0-9a-f]{6}$' then return false; end if;
    elsif chave in ('fundoImagem', 'logo') then
      if jsonb_typeof(valor) <> 'null' and (jsonb_typeof(valor) <> 'string'
         or valor #>> '{}' !~ '^https?://[a-z0-9.:-]+/storage/v1/object/public/produtos/catalogo/[a-z0-9-]+\.(png|jpe?g|webp)$') then
        return false;
      end if;
    elsif chave = 'decoracoes' then
      -- Elementos adicionados no Figma: imagem do Storage + posição/tamanho em % da folha
      if jsonb_typeof(valor) <> 'array' or jsonb_array_length(valor) > 8 then return false; end if;
      for d in select * from jsonb_array_elements(valor) loop
        if jsonb_typeof(d) <> 'object' then return false; end if;
        for sub, v in select * from jsonb_each(d) loop
          if sub = 'imagem' then
            if jsonb_typeof(v) <> 'string'
               or v #>> '{}' !~ '^https?://[a-z0-9.:-]+/storage/v1/object/public/produtos/catalogo/[a-z0-9-]+\.(png|jpe?g|webp)$' then
              return false;
            end if;
          elsif sub in ('x', 'y') then
            if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between -100 and 200 then return false; end if;
          elsif sub in ('largura', 'altura') then
            if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0.1 and 300 then return false; end if;
          else
            return false;
          end if;
        end loop;
      end loop;
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
notify pgrst, 'reload schema';
