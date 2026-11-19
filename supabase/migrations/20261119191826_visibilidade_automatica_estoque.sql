-- Visibilidade é uma preferência separada do saldo. Não altera estoque nem
-- esconde componentes do cálculo de kits quando a garrafa avulsa se esgota.
alter table public.produtos add column visibilidade text not null default 'automatico'
  check(visibilidade in ('automatico','visivel','oculto'));
alter table public.produtos add column consumo_proprio boolean not null default false;
update public.produtos set visibilidade='oculto' where not ativo;

create or replace function privado.normalizar_visibilidade_produto() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(with recursive ancestrais as (
    select id,pai_id,slug from public.categorias where id=new.categoria_id
    union select c.id,c.pai_id,c.slug from public.categorias c join ancestrais a on a.pai_id=c.id
  ) select 1 from ancestrais where slug in ('insumos','consumo-proprio')) then
    new.consumo_proprio := true;
  end if;
  if tg_op='INSERT' then
    if new.visibilidade='automatico' and (not new.ativo or new.consumo_proprio) then new.visibilidade:='oculto'; end if;
  else
    -- Compatibilidade com botões antigos que alteram apenas ativo.
    if new.visibilidade=old.visibilidade and new.ativo is distinct from old.ativo then
      new.visibilidade:=case when new.ativo then 'visivel' else 'oculto' end;
    end if;
    if new.consumo_proprio and new.visibilidade='automatico' then new.visibilidade:='oculto'; end if;
  end if;
  new.ativo := new.visibilidade<>'oculto';
  return new;
end;$$;
revoke all on function privado.normalizar_visibilidade_produto() from public,anon,authenticated;
create trigger produtos_visibilidade before insert or update of categoria_id,consumo_proprio,visibilidade,ativo
on public.produtos for each row execute function privado.normalizar_visibilidade_produto();

with recursive internas as (
  select id from public.categorias where slug in('insumos','consumo-proprio')
  union select c.id from public.categorias c join internas i on c.pai_id=i.id
)
update public.produtos p set consumo_proprio=true,visibilidade='oculto',ativo=false
where p.categoria_id in(select id from internas) or exists(select 1 from public.produto_importacao i
 where i.produto_id=p.id and i.origem->>'tipo' in('insumo','consumo_proprio'));

create or replace function privado.salvar_visibilidade_produto(p_id uuid,p_dados jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_dados ? 'visibilidade' or p_dados ? 'consumo_proprio' then
    update public.produtos set
      visibilidade=coalesce(p_dados->>'visibilidade',visibilidade),
      consumo_proprio=coalesce((p_dados->>'consumo_proprio')::boolean,consumo_proprio),
      ativo=coalesce(p_dados->>'visibilidade',visibilidade)<>'oculto'
    where id=p_id;
  end if;
end;$$;
revoke all on function privado.salvar_visibilidade_produto(uuid,jsonb) from public,anon,authenticated;

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
  if p_familia is null then
    perform privado.salvar_visibilidade_produto(p_id,p_dados);
    select to_jsonb(p) into resultado from public.produtos p where id=p_id;
  else
    for linha in select * from jsonb_array_elements(p_variacoes) loop
      perform privado.salvar_visibilidade_produto((linha->>'id')::uuid,p_dados||linha);
    end loop;
    select jsonb_agg(to_jsonb(p) order by e.ord) into resultado
      from jsonb_array_elements(p_variacoes) with ordinality e(dados,ord)
      join public.produtos p on p.id=(e.dados->>'id')::uuid;
  end if;
  return resultado;
end;
$$;
revoke all on function public.salvar_cadastro_produto(uuid,jsonb,jsonb,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.salvar_cadastro_produto(uuid,jsonb,jsonb,uuid,text,jsonb,jsonb) to authenticated;

-- Cópia independente do cadastro. Não duplica saldo, vendas ou movimentações.
create or replace function public.clonar_produto(
  p_origem uuid, p_novo uuid, p_incluir_variacoes boolean default true,
  p_fotos jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  fonte public.produtos%rowtype;
  item public.produtos%rowtype;
  grupo public.grupos_opcoes%rowtype;
  novo_id uuid;
  nova_familia uuid;
  novo_grupo uuid;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_novo is null or p_origem is null then raise exception 'Produto inválido.'; end if;
  -- Repetir a mesma solicitação após falha de rede devolve a cópia já criada.
  if exists(select 1 from public.produtos where id=p_novo) then
    if exists(select 1 from public.produto_importacao i where i.produto_id=p_novo
      and i.origem->>'clonado_de'=p_origem::text and i.origem->>'clonagem'=p_novo::text) then
      return p_novo;
    end if;
    raise exception 'Identificador já utilizado. Reabra a lista e tente novamente.';
  end if;
  select * into fonte from public.produtos where id=p_origem;
  if not found then raise exception 'O produto original não existe mais.'; end if;
  if fonte.familia_id is not null and p_incluir_variacoes then
    nova_familia := gen_random_uuid();
  end if;
  for item in select p.* from public.produtos p
    where p.id=p_origem or (nova_familia is not null and p.familia_id=fonte.familia_id)
    order by (p.id=p_origem) desc, p.ordem, p.id
  loop
    novo_id := case when item.id=p_origem then p_novo else gen_random_uuid() end;
    insert into public.produtos (
      id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,
      controla_estoque,estoque,eh_kit,unidade_estoque,volume_unidade,
      familia_id,familia_nome,variacao_atributo,variacao_nome,
      unidades_pacote,vende_pacote,preco_pendente,visibilidade,consumo_proprio
    ) values (
      novo_id,item.categoria_id,
      case when nova_familia is null then item.nome||' (CÓPIA)'
        else coalesce(fonte.familia_nome,fonte.nome)||' (CÓPIA) · '||item.variacao_nome end,
      item.descricao,item.preco,coalesce(p_fotos->>item.id::text,item.foto_url),
      item.destaque,item.disponivel,false,item.ordem,
      item.controla_estoque,0,item.eh_kit,item.unidade_estoque,item.volume_unidade,
      nova_familia,
      case when nova_familia is not null then coalesce(fonte.familia_nome,fonte.nome)||' (CÓPIA)' end,
      case when nova_familia is not null then item.variacao_atributo end,
      case when nova_familia is not null then item.variacao_nome end,
      item.unidades_pacote,item.vende_pacote,item.preco_pendente,'oculto',item.consumo_proprio
    );
    insert into public.produto_importacao(produto_id,codigo,codigo_pai,custo,origem)
    values(novo_id,null,null,(select custo from public.produto_importacao where produto_id=item.id),
      jsonb_build_object('fonte','clonagem','clonado_de',item.id,'clonagem',p_novo));
    insert into public.kit_componentes(kit_id,componente_id,quantidade)
      select novo_id,componente_id,quantidade from public.kit_componentes where kit_id=item.id;
    for grupo in select * from public.grupos_opcoes where produto_id=item.id order by ordem,id
    loop
      novo_grupo := gen_random_uuid();
      insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo,ordem)
        values(novo_grupo,novo_id,grupo.nome,grupo.minimo,grupo.maximo,grupo.ordem);
      insert into public.opcoes(grupo_id,nome,preco,disponivel,ordem,componente_id,quantidade_consumo)
        select novo_grupo,nome,preco,disponivel,ordem,componente_id,quantidade_consumo
        from public.opcoes where grupo_id=grupo.id;
    end loop;
  end loop;
  return p_novo;
end;
$$;
revoke all on function public.clonar_produto(uuid,uuid,boolean,jsonb) from public,anon;
grant execute on function public.clonar_produto(uuid,uuid,boolean,jsonb) to authenticated;


notify pgrst,'reload schema';
