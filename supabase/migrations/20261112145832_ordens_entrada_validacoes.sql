create or replace function public.importar_nfe_xml(p_xml text,p_arquivo text default 'nota.xml')
returns jsonb language plpgsql security definer set search_path='' as $$
<<importacao>>
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
 select id into oid from public.ordens_entrada where ordens_entrada.chave=importacao.chave;
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


alter table public.ordens_entrada add constraint ordens_entrada_total_finito check(total_nota<=1000000000000);
alter table public.ordens_entrada_itens add constraint ordens_entrada_itens_numeros_finitos check(
quantidade_nota<=1000000000 and custo_nota<=1000000000 and total_item<=1000000000000 and
(quantidade_recebida is null or quantidade_recebida<=1000000000) and
(custo_conferido is null or custo_conferido<=1000000000));
notify pgrst,'reload schema';
