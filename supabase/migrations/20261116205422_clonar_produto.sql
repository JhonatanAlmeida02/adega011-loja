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
      unidades_pacote,vende_pacote,preco_pendente
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
      item.unidades_pacote,item.vende_pacote,item.preco_pendente
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
