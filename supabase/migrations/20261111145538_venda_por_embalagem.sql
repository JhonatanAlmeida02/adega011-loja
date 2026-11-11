-- Base stock stays in leaves/pieces or ml. A sale can consume one entire package.
alter table public.produtos add column vende_pacote boolean not null default false;
comment on column public.produtos.volume_unidade is 'Quantidade base consumida por unidade vendida: ml do recipiente/litro, UN do pacote, ou 1 na venda avulsa.';
create or replace function privado.validar_modelo_estoque()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.unidade_estoque <> old.unidade_estoque then
    if old.estoque <> 0 or exists(select 1 from public.estoque_movimentos m where m.produto_id=old.id)
      or exists(select 1 from public.kit_componentes c where c.componente_id=old.id) then
      raise exception 'A unidade não pode mudar após movimentações ou vínculos de kits. Cadastre um novo produto base para ml.';
    end if;
  end if;
  if new.unidade_estoque='un' then
    new.volume_unidade:=case when new.vende_pacote then new.unidades_pacote else 1 end;
  else new.vende_pacote:=false;end if;
  if new.eh_kit then
    if tg_op='UPDATE' and not old.eh_kit and exists(select 1 from public.estoque_movimentos m where m.produto_id=old.id) then
      raise exception 'Este produto tem histórico próprio de estoque. Crie um kit separado para preservar as movimentações.';
    end if;
    if new.estoque <> 0 then raise exception 'Zere o estoque próprio antes de transformar o produto em kit.'; end if;
    if exists(select 1 from public.kit_componentes c where c.componente_id=new.id) then
      raise exception 'Este produto já é componente de outro kit. Kits devem usar produtos simples.';
    end if;
    new.controla_estoque:=false;
    new.unidade_estoque:='un'; new.volume_unidade:=1; new.vende_pacote:=false;
  elsif tg_op='UPDATE' and old.eh_kit then
    delete from public.kit_componentes where kit_id=old.id;
  end if;
  if not new.controla_estoque and not new.eh_kit and exists(select 1 from public.kit_componentes c where c.componente_id=new.id) then
    raise exception 'Este produto abastece kits e precisa continuar com controle de estoque.';
  end if;
  return new;
end;
$$;

create or replace function public.salvar_produto_com_kit(p_id uuid,p_dados jsonb,p_componentes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.produtos%rowtype; v_kit boolean; v_ordem integer; v_categoria uuid;
begin
  perform privado.exigir_admin();
  perform pg_advisory_xact_lock(11011011);
  if p_id is null or p_dados is null or jsonb_typeof(p_dados)<>'object' then
    raise exception 'Cadastro inválido.';
  end if;
  v_kit:=coalesce((p_dados->>'eh_kit')::boolean,false);
  if v_kit and (p_componentes is null or jsonb_typeof(p_componentes)<>'array' or jsonb_array_length(p_componentes)=0) then
    raise exception 'Adicione pelo menos um componente ao kit.';
  end if;
  if coalesce(btrim(p_dados->>'nome'),'')='' then raise exception 'Informe o nome do produto.';end if;
  v_categoria:=nullif(p_dados->>'categoria_id','')::uuid;
  select * into v from public.produtos where id=p_id for update;
  if found then v_ordem:=v.ordem;
  else select coalesce(max(ordem),-1)+1 into v_ordem from public.produtos where categoria_id is not distinct from v_categoria;
  end if;
  -- Explicitly list writable fields; never accept stock balance from the client.
  insert into public.produtos(id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote)
  values(p_id,v_categoria,btrim(p_dados->>'nome'),coalesce(btrim(p_dados->>'descricao'),''),(p_dados->>'preco')::integer,
    nullif(p_dados->>'foto_url',''),coalesce((p_dados->>'destaque')::boolean,false),
    coalesce((p_dados->>'disponivel')::boolean,true),coalesce((p_dados->>'ativo')::boolean,true),v_ordem,
    not v_kit and coalesce((p_dados->>'controla_estoque')::boolean,false),v_kit,
    case when v_kit then 'un' else coalesce(p_dados->>'unidade_estoque','un') end,
    case when not v_kit and p_dados->>'unidade_estoque'='ml' then coalesce((p_dados->>'volume_unidade')::integer,1) else 1 end,
    case when v_kit then 1 else coalesce((p_dados->>'unidades_pacote')::integer,v.unidades_pacote,1) end,
    case when not v_kit and coalesce(p_dados->>'unidade_estoque','un')='un' then coalesce((p_dados->>'vende_pacote')::boolean,v.vende_pacote,false) else false end)
  on conflict(id) do update set categoria_id=excluded.categoria_id,nome=excluded.nome,descricao=excluded.descricao,
    preco=excluded.preco,foto_url=excluded.foto_url,destaque=excluded.destaque,disponivel=excluded.disponivel,
    ativo=excluded.ativo,controla_estoque=excluded.controla_estoque,eh_kit=excluded.eh_kit,
    unidade_estoque=excluded.unidade_estoque,volume_unidade=excluded.volume_unidade,unidades_pacote=excluded.unidades_pacote,vende_pacote=excluded.vende_pacote
  returning * into v;
  if v_kit then perform public.salvar_composicao_kit(p_id,p_componentes);end if;
  return to_jsonb(v);
end;
$$;
revoke all on function public.salvar_produto_com_kit(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.salvar_produto_com_kit(uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';


notify pgrst,'reload schema';
