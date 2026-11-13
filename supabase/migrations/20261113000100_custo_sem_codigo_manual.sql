-- Custo digitado no cadastro não inventa mais um código "MANUAL-<id>".
--
-- Antes o SKU era obrigatório em produto_importacao, então salvar_cadastro_produto
-- criava "MANUAL-<id>" para guardar o custo de um produto sem SKU. Agora o SKU é
-- opcional (20261113000000_sku_no_cadastro) e aparece no cadastro; o código
-- inventado ficaria visível como se fosse o SKU do produto.

create or replace function public.salvar_cadastro_produto(
  p_id uuid, p_dados jsonb, p_componentes jsonb, p_familia uuid,
  p_atributo text, p_variacoes jsonb, p_custos jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare resultado jsonb; ids uuid[]; linha jsonb; sku uuid; valor numeric;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_custos is null or jsonb_typeof(p_custos)<>'array' then
    raise exception 'Informe uma lista válida de custos.';
  end if;
  if jsonb_array_length(p_custos)>50 then raise exception 'Informe no máximo 50 custos.';end if;
  if exists(select 1 from jsonb_array_elements(p_custos)e group by e->>'produto_id' having count(*)>1) then
    raise exception 'Há custos duplicados para o mesmo produto.';
  end if;
  if p_familia is null then
    resultado:=public.salvar_produto_com_kit(p_id,p_dados,p_componentes);
    ids:=array[p_id];
  else
    resultado:=public.salvar_produto_variacoes(p_familia,p_dados,p_atributo,p_variacoes);
    select array_agg((e->>'id')::uuid) into ids from jsonb_array_elements(resultado)e;
  end if;
  for linha in select * from jsonb_array_elements(p_custos) loop
    sku:=(linha->>'produto_id')::uuid;
    if sku is null or not(sku=any(ids)) then raise exception 'O custo deve pertencer a um produto deste cadastro.';end if;
    if not(linha ? 'custo') or jsonb_typeof(linha->'custo') not in ('number','null') then
      raise exception 'Informe um custo válido em centavos.';
    end if;
    valor:=(linha->>'custo')::numeric;
    if valor is not null and (valor<0 or valor<>trunc(valor) or valor>2147483647) then
      raise exception 'O custo deve ser positivo ou zero, em centavos inteiros.';
    end if;
    if valor is null then
      update public.produto_importacao set custo=null where produto_id=sku;
    else
      insert into public.produto_importacao(produto_id,codigo,custo,origem)
      values(sku,null,valor::integer,'{"cadastro_manual":true}')
      on conflict(produto_id) do update set custo=excluded.custo;
    end if;
  end loop;
  return resultado;
end;
$$;
revoke all on function public.salvar_cadastro_produto(uuid,jsonb,jsonb,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.salvar_cadastro_produto(uuid,jsonb,jsonb,uuid,text,jsonb,jsonb) to authenticated;

-- Códigos inventados que já existem viram "sem SKU" (o custo continua).
update public.produto_importacao set codigo=null
 where codigo = 'MANUAL-' || produto_id::text;

notify pgrst,'reload schema';
