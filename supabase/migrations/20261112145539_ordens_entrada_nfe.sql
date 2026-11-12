-- NF-e: importar somente rascunhos; estoque apenas na confirmação atômica.
create table public.ordens_entrada (
 id uuid primary key default gen_random_uuid(),
 numero bigint generated always as identity unique,
 chave text not null unique check(chave ~ '^[0-9]{44}$'),
 nota_numero text not null, serie text not null,
 fornecedor_nome text not null, fornecedor_documento text not null,
 destinatario_documento text, emitida_em timestamptz,
 total_nota numeric(18,2) not null check(total_nota>=0),
 arquivo_nome text not null, xml_original text not null,
 status text not null default 'pendente' check(status in ('pendente','lancada','cancelada')),
 versao integer not null default 1,
 observacoes text not null default '',
 criado_em timestamptz not null default now(), criado_por uuid references auth.users(id) on delete set null,
 atualizado_em timestamptz not null default now(),
 lancado_em timestamptz, lancado_por uuid references auth.users(id) on delete set null
);
create table public.ordens_entrada_itens (
 id uuid primary key default gen_random_uuid(),
 ordem_id uuid not null references public.ordens_entrada(id) on delete cascade,
 numero_item integer not null check(numero_item>0),
 codigo_fornecedor text not null, ean text, descricao text not null,
 unidade_nota text not null, quantidade_nota numeric(18,4) not null check(quantidade_nota>0),
 custo_nota numeric(20,10) not null check(custo_nota>=0), total_item numeric(18,2) not null check(total_item>=0),
 produto_id uuid references public.produtos(id) on delete restrict,
 quantidade_recebida numeric(18,4) check(quantidade_recebida>0),
 fator numeric(18,6) check(fator>0 and fator<=1000000000),
 unidade_estoque text check(unidade_estoque in ('un','ml')),
 custo_conferido numeric(20,10) check(custo_conferido>=0),
 conferido boolean not null default false, ignorar boolean not null default false,
 produto_nome_snapshot text, quantidade_lancada integer,
 unique(ordem_id,numero_item)
);
create index ordens_entrada_criado_em_idx on public.ordens_entrada(criado_em desc);
create index ordens_entrada_criado_por_idx on public.ordens_entrada(criado_por);
create index ordens_entrada_lancado_por_idx on public.ordens_entrada(lancado_por);
create index ordens_entrada_itens_produto_idx on public.ordens_entrada_itens(produto_id);
alter table public.ordens_entrada enable row level security;
alter table public.ordens_entrada_itens enable row level security;
revoke all on public.ordens_entrada,public.ordens_entrada_itens from public,anon,authenticated;
grant select on public.ordens_entrada,public.ordens_entrada_itens to authenticated;
create policy ordens_entrada_admin_le on public.ordens_entrada for select to authenticated using((select public.is_admin()));
create policy ordens_entrada_itens_admin_le on public.ordens_entrada_itens for select to authenticated using((select public.is_admin()));

create function public.importar_nfe_xml(p_xml text,p_arquivo text default 'nota.xml')
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc xml; cab record; item record; chave text; prot text; oid uuid; candidatos uuid[];
begin
 perform privado.exigir_admin();
 if p_xml is null or octet_length(p_xml)>3145728 or length(p_xml)<50 then raise exception 'Envie um XML de NF-e com até 3 MB.';end if;
 if p_xml ~* '<!\s*(DOCTYPE|ENTITY)' then raise exception 'XML com DTD ou entidades externas não é permitido.';end if;
 begin doc:=xmlparse(document p_xml); exception when others then raise exception 'O arquivo não contém um XML válido.';end;
 if cardinality(xpath('/n:nfeProc/n:NFe/n:infNFe | /n:NFe/n:infNFe',doc,array[array['n','http://www.portalfiscal.inf.br/nfe']]))<>1 then
  raise exception 'Envie o XML de uma única NF-e, não um evento, resumo ou DANFE.';
 end if;
 select * into cab from xmltable(xmlnamespaces('http://www.portalfiscal.inf.br/nfe' as n),
 '/n:nfeProc/n:NFe/n:infNFe | /n:NFe/n:infNFe' passing doc columns
 identificador text path '@Id', modelo text path 'n:ide/n:mod', numero text path 'n:ide/n:nNF', serie text path 'n:ide/n:serie',
 emissao text path 'n:ide/n:dhEmi', emissao_antiga text path 'n:ide/n:dEmi', tipo text path 'n:ide/n:tpNF',
 fornecedor text path 'n:emit/n:xNome', cnpj text path 'n:emit/n:CNPJ', cpf text path 'n:emit/n:CPF',
 destinatario text path 'n:dest/n:CNPJ | n:dest/n:CPF', total numeric path 'n:total/n:ICMSTot/n:vNF') t;
 chave:=substring(cab.identificador from '^NFe([0-9]{44})$');
 if chave is null or cab.modelo is distinct from '55' or cab.tipo is distinct from '1' or
  coalesce(cab.numero,'')='' or coalesce(cab.serie,'')='' or coalesce(cab.fornecedor,'')='' or
  coalesce(cab.cnpj,cab.cpf,'') !~ '^([0-9]{14}|[0-9]{11})$' or cab.total is null or cab.total<0 then
  raise exception 'XML sem os dados obrigatórios de uma NF-e de saída do fornecedor (modelo 55).';
 end if;
 select estado into prot from xmltable(xmlnamespaces('http://www.portalfiscal.inf.br/nfe' as n),
 '/n:nfeProc/n:protNFe/n:infProt' passing doc columns estado text path 'n:cStat') t;
 if prot is null or prot not in ('100','150') or
  (xpath('string(/n:nfeProc/n:protNFe/n:infProt/n:chNFe)',doc,array[array['n','http://www.portalfiscal.inf.br/nfe']]))[1]::text is distinct from chave then
  raise exception 'Envie o XML processado da NF-e com protocolo de autorização (nfeProc).';
 end if;
 if cardinality(xpath('/n:nfeProc/n:NFe/n:infNFe/n:det',doc,array[array['n','http://www.portalfiscal.inf.br/nfe']])) not between 1 and 500 then
  raise exception 'A nota deve conter de 1 a 500 itens.';
 end if;
 -- Chave única + trava: retries e importações simultâneas reabrem a mesma ordem.
 perform pg_advisory_xact_lock(hashtextextended(chave,11011));
 select id into oid from public.ordens_entrada where ordens_entrada.chave=importar_nfe_xml.chave;
 if found then return jsonb_build_object('id',oid,'existente',true);end if;
 insert into public.ordens_entrada(chave,nota_numero,serie,fornecedor_nome,fornecedor_documento,destinatario_documento,emitida_em,total_nota,arquivo_nome,xml_original,criado_por)
 values(chave,cab.numero,cab.serie,cab.fornecedor,coalesce(cab.cnpj,cab.cpf),cab.destinatario,
  coalesce(cab.emissao,cab.emissao_antiga)::timestamptz,cab.total,left(coalesce(p_arquivo,'nota.xml'),180),p_xml,auth.uid()) returning id into oid;
 for item in select * from xmltable(xmlnamespaces('http://www.portalfiscal.inf.br/nfe' as n),
 '/n:nfeProc/n:NFe/n:infNFe/n:det' passing doc columns numero integer path '@nItem',
 codigo text path 'n:prod/n:cProd', ean text path 'n:prod/n:cEAN', descricao text path 'n:prod/n:xProd',
 unidade text path 'n:prod/n:uCom', quantidade numeric path 'n:prod/n:qCom', custo numeric path 'n:prod/n:vUnCom', total numeric path 'n:prod/n:vProd') t loop
  if coalesce(item.codigo,'')='' or coalesce(item.descricao,'')='' or coalesce(item.unidade,'')='' or
   item.quantidade is null or item.quantidade<=0 or item.quantidade>1000000000 or
   item.custo is null or item.custo<0 or item.total is null or item.total<0 then raise exception 'Há um item sem descrição, unidade, quantidade ou valor válido.';end if;
  -- Só sugerimos correspondência exata e única. Código do fornecedor não é nosso SKU.
  select array_agg(id) into candidatos from public.produtos where not eh_kit and controla_estoque and lower(btrim(nome))=lower(btrim(item.descricao));
  insert into public.ordens_entrada_itens(ordem_id,numero_item,codigo_fornecedor,ean,descricao,unidade_nota,quantidade_nota,custo_nota,total_item,quantidade_recebida,custo_conferido,produto_id)
  values(oid,item.numero,item.codigo,item.ean,item.descricao,item.unidade,item.quantidade,item.custo,item.total,item.quantidade,item.custo,
   case when cardinality(candidatos)=1 then candidatos[1] end);
 end loop;
 return jsonb_build_object('id',oid,'existente',false);
end;$$;

create function public.salvar_ordem_entrada(p_id uuid,p_versao integer,p_itens jsonb,p_observacoes text default '')
returns integer language plpgsql security definer set search_path='' as $$
declare ordem public.ordens_entrada%rowtype; linha jsonb; prod public.produtos%rowtype; iid uuid; ids uuid[]; nova integer;
begin
 perform privado.exigir_admin();
 select * into ordem from public.ordens_entrada where id=p_id for update;
 if not found then raise exception 'Ordem de entrada não encontrada.';end if;
 if ordem.status<>'pendente' then raise exception 'Esta ordem não permite alterações.';end if;
 if ordem.versao is distinct from p_versao then raise exception 'A ordem foi alterada em outra aba. Reabra para conferir a versão atual.';end if;
 if p_itens is null or jsonb_typeof(p_itens)<>'array' then raise exception 'Informe os itens da ordem.';end if;
 select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(p_itens)x;
 if cardinality(ids) is distinct from (select count(*)::int from public.ordens_entrada_itens where ordem_id=p_id) or
  cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or
  exists(select 1 from unnest(ids)x where x is null or not exists(select 1 from public.ordens_entrada_itens where id=x and ordem_id=p_id)) then
  raise exception 'Os itens da ordem mudaram. Reabra a conferência.';
 end if;
 for linha in select * from jsonb_array_elements(p_itens) loop
  iid:=(linha->>'id')::uuid;
  if nullif(linha->>'produto_id','') is not null then
   select * into prod from public.produtos where id=(linha->>'produto_id')::uuid;
   if not found or prod.eh_kit or not prod.controla_estoque then raise exception 'Vincule cada item a um produto simples com controle de estoque.';end if;
   if nullif(linha->>'unidade_estoque','') is not null and linha->>'unidade_estoque' is distinct from prod.unidade_estoque then
    raise exception 'A unidade do produto mudou. Confira novamente o vínculo e a conversão.';end if;
  end if;
  update public.ordens_entrada_itens set
   produto_id=nullif(linha->>'produto_id','')::uuid,
   quantidade_recebida=nullif(linha->>'quantidade_recebida','')::numeric,
   fator=nullif(linha->>'fator','')::numeric,
   unidade_estoque=nullif(linha->>'unidade_estoque',''),
   custo_conferido=nullif(linha->>'custo_conferido','')::numeric,
   conferido=coalesce((linha->>'conferido')::boolean,false),ignorar=coalesce((linha->>'ignorar')::boolean,false)
  where id=iid;
 end loop;
 update public.ordens_entrada set observacoes=left(coalesce(p_observacoes,''),1000),versao=versao+1,atualizado_em=now() where id=p_id returning versao into nova;
 return nova;
end;$$;

create function public.confirmar_ordem_entrada(p_id uuid,p_versao integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ordem public.ordens_entrada%rowtype; linha record; prod public.produtos%rowtype; total numeric; mov uuid; saldo integer;
begin
 perform privado.exigir_admin();
 -- Mesma trava global das vendas/entradas: evita concorrência e deadlocks com kits.
 perform pg_advisory_xact_lock(11011011);
 select * into ordem from public.ordens_entrada where id=p_id for update;
 if not found then raise exception 'Ordem de entrada não encontrada.';end if;
 if ordem.status='lancada' then return jsonb_build_object('id',p_id,'ja_lancada',true);end if;
 if ordem.status<>'pendente' then raise exception 'Esta ordem foi cancelada.';end if;
 if ordem.versao is distinct from p_versao then raise exception 'A ordem foi alterada. Reabra antes de lançar o estoque.';end if;
 if not exists(select 1 from public.ordens_entrada_itens where ordem_id=p_id and not ignorar) then raise exception 'Selecione pelo menos um item para lançar.';end if;
 for linha in select * from public.ordens_entrada_itens where ordem_id=p_id order by numero_item loop
  if not linha.conferido then raise exception 'Confira todos os itens, inclusive os que não serão lançados.';end if;
  if linha.ignorar then continue;end if;
  select * into prod from public.produtos where id=linha.produto_id for update;
  if not found or prod.eh_kit or not prod.controla_estoque then raise exception 'Item %: vincule um produto simples com controle de estoque.',linha.numero_item;end if;
  if linha.unidade_estoque is distinct from prod.unidade_estoque then raise exception 'Item %: confira a unidade e a conversão do produto.',linha.numero_item;end if;
  total:=linha.quantidade_recebida*linha.fator;
  if total is null or total<=0 or total<>trunc(total) or total>1000000000 or linha.custo_conferido is null then
   raise exception 'Item %: informe quantidade, custo e conversão para um número inteiro de %.',linha.numero_item,prod.unidade_estoque;
  end if;
  saldo:=public.ajustar_estoque(prod.id,'entrada',total::integer,
   format('OE %s · NF %s/%s · item %s · %s x %s %s · chave %s',ordem.numero,ordem.nota_numero,ordem.serie,linha.numero_item,linha.quantidade_recebida,linha.fator,prod.unidade_estoque,ordem.chave));
  update public.ordens_entrada_itens set quantidade_lancada=total::integer,produto_nome_snapshot=prod.nome where id=linha.id;
 end loop;
 update public.ordens_entrada set status='lancada',versao=versao+1,lancado_em=now(),lancado_por=auth.uid(),atualizado_em=now() where id=p_id;
 return jsonb_build_object('id',p_id,'ja_lancada',false);
end;$$;

create function public.cancelar_ordem_entrada(p_id uuid,p_versao integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform privado.exigir_admin();
 update public.ordens_entrada set status='cancelada',versao=versao+1,atualizado_em=now()
 where id=p_id and versao=p_versao and status='pendente';
 if not found then raise exception 'A ordem mudou ou já foi lançada. Reabra a lista.';end if;
end;$$;
revoke all on function public.importar_nfe_xml(text,text),public.salvar_ordem_entrada(uuid,integer,jsonb,text),public.confirmar_ordem_entrada(uuid,integer),public.cancelar_ordem_entrada(uuid,integer) from public,anon;
grant execute on function public.importar_nfe_xml(text,text),public.salvar_ordem_entrada(uuid,integer,jsonb,text),public.confirmar_ordem_entrada(uuid,integer),public.cancelar_ordem_entrada(uuid,integer) to authenticated;
notify pgrst,'reload schema';
