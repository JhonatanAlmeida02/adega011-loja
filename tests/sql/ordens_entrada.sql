-- Testes de integração: nenhum produto, ordem ou estoque permanece no banco.
begin;
set local statement_timeout='25s';
do $test$
declare admin_id uuid; produto uuid:=gen_random_uuid(); garrafa uuid:=gen_random_uuid();
 chave text:='35261112345678000199550010000000011234567890'; xml_nota text; r jsonb; ordem uuid; versao integer;
 linhas jsonb; i record; estoque_antes integer; movimentos_antes integer; custo_antes integer;
begin
 select user_id into admin_id from public.admins limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,volume_unidade,unidades_pacote)
 values(produto,'QA XML pacote',500,true,'un',1,50),(garrafa,'QA XML energético',1500,true,'ml',2000,1);
 perform public.ajustar_estoque(produto,'entrada',7);
 xml_nota:=format($xml$<?xml version="1.0" encoding="UTF-8"?>
 <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe%s" versao="4.00">
 <ide><mod>55</mod><nNF>1</nNF><serie>1</serie><dhEmi>2026-11-12T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
 <emit><CNPJ>12345678000199</CNPJ><xNome>Distribuidora &amp; Cia</xNome></emit><dest><CNPJ>98765432000100</CNPJ></dest>
 <det nItem="1"><prod><cProd>FORN-1</cProd><cEAN>SEM GTIN</cEAN><xProd>QA XML pacote</xProd><uCom>PCT</uCom><qCom>10.0000</qCom><vUnCom>5.1234567890</vUnCom><vProd>51.23</vProd></prod></det>
 <det nItem="2"><prod><cProd>FORN-2</cProd><xProd>QA XML energético</xProd><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>12.00</vUnCom><vProd>24.00</vProd></prod></det>
 <total><ICMSTot><vNF>75.23</vNF></ICMSTot></total></infNFe></NFe>
 <protNFe><infProt><chNFe>%s</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>$xml$,chave,chave);
 select count(*) into movimentos_antes from public.estoque_movimentos;
 r:=public.importar_nfe_xml(xml_nota,'teste.xml'); ordem:=(r->>'id')::uuid;
 if (select estoque from public.produtos where id=produto)<>7 or (select count(*) from public.estoque_movimentos)<>movimentos_antes then raise exception 'FAIL import alterou estoque';end if;
 if (select fornecedor_nome from public.ordens_entrada where id=ordem)<>'Distribuidora & Cia' then raise exception 'FAIL entidades XML';end if;
 if (select count(*) from public.ordens_entrada_itens where ordem_id=ordem)<>2 then raise exception 'FAIL itens';end if;
 if (select custo_nota from public.ordens_entrada_itens where ordem_id=ordem and numero_item=1)<>5.1234567890 then raise exception 'FAIL precisão de custo';end if;
 r:=public.importar_nfe_xml(xml_nota,'repetida.xml');
 if (r->>'id')::uuid<>ordem or not (r->>'existente')::boolean then raise exception 'FAIL duplicidade';end if;
 if (select count(*) from public.ordens_entrada_itens where ordem_id=ordem)<>2 then raise exception 'FAIL duplicou itens';end if;
 begin
  perform public.confirmar_ordem_entrada(ordem,1);raise exception using errcode='XX000',message='FAIL sem conferência';
 exception when sqlstate 'P0001' then null;end;
 select jsonb_agg(to_jsonb(t)||jsonb_build_object('fator',case when numero_item=1 then 50 else 2000 end,'unidade_estoque',case when numero_item=1 then 'un' else 'ml' end,'conferido',true)) into linhas from public.ordens_entrada_itens t where ordem_id=ordem;
 versao:=public.salvar_ordem_entrada(ordem,1,linhas,'Mercadoria conferida');
 if (select estoque from public.produtos where id=produto)<>7 then raise exception 'FAIL salvar alterou estoque';end if;
 begin
  perform public.salvar_ordem_entrada(ordem,1,linhas,'stale');raise exception using errcode='XX000',message='FAIL edição concorrente';
 exception when sqlstate 'P0001' then null;end;
 -- Falha no segundo item deve reverter inclusive o primeiro.
 update public.ordens_entrada_itens set quantidade_recebida=0.0001,fator=1 where ordem_id=ordem and numero_item=2;
 begin
  perform public.confirmar_ordem_entrada(ordem,versao);raise exception using errcode='XX000',message='FAIL fração de ml aceita';
 exception when sqlstate 'P0001' then null;end;
 if (select estoque from public.produtos where id=produto)<>7 or (select count(*) from public.estoque_movimentos)<>movimentos_antes then raise exception 'FAIL atomicidade';end if;
 update public.ordens_entrada_itens set quantidade_recebida=2,fator=2000 where ordem_id=ordem and numero_item=2;
 perform public.confirmar_ordem_entrada(ordem,versao);
 if (select estoque from public.produtos where id=produto)<>507 or (select estoque from public.produtos where id=garrafa)<>4000 then raise exception 'FAIL conversão';end if;
 if (select status from public.ordens_entrada where id=ordem)<>'lancada' or (select lancado_por from public.ordens_entrada where id=ordem) is distinct from admin_id then raise exception 'FAIL auditoria';end if;
 if (select count(*) from public.estoque_movimentos where observacao like 'OE %' and produto_id in (produto,garrafa))<>2 then raise exception 'FAIL histórico';end if;
 perform public.confirmar_ordem_entrada(ordem,versao);
 r:=public.importar_nfe_xml(xml_nota,'depois.xml');
 if (select estoque from public.produtos where id=produto)<>507 then raise exception 'FAIL retry lançou novamente';end if;
 begin
  perform public.salvar_ordem_entrada(ordem,versao,linhas,'');raise exception using errcode='XX000',message='FAIL edição pós-lançamento';
 exception when sqlstate 'P0001' then null;end;
 begin
  perform public.cancelar_ordem_entrada(ordem,versao);raise exception using errcode='XX000',message='FAIL cancelamento pós-lançamento';
 exception when sqlstate 'P0001' then null;end;
 -- XML inseguro, malformado e sem autorização não geram ordem parcial.
 begin
  perform public.importar_nfe_xml('<!DOCTYPE x [<!ENTITY teste SYSTEM "http://example.com">]><x/>');raise exception using errcode='XX000',message='FAIL DTD';
 exception when sqlstate 'P0001' then null;end;
 begin
  perform public.importar_nfe_xml(repeat('x',3145729));raise exception using errcode='XX000',message='FAIL limite XML';
 exception when sqlstate 'P0001' then null;end;
 begin
  perform public.importar_nfe_xml(replace(xml_nota,'<cStat>100</cStat>','<cStat>101</cStat>'));raise exception using errcode='XX000',message='FAIL autorização';
 exception when sqlstate 'P0001' then null;end;
 begin
  perform public.importar_nfe_xml(replace(xml_nota,'</NFe>',''));raise exception using errcode='XX000',message='FAIL malformado';
 exception when sqlstate 'P0001' then null;end;
 -- Outra ordem pode ser cancelada sem entrada.
 r:=public.importar_nfe_xml(replace(xml_nota,chave,'35261112345678000199550010000000021234567890'));
 perform public.cancelar_ordem_entrada((r->>'id')::uuid,1);
 begin
  perform public.confirmar_ordem_entrada((r->>'id')::uuid,2);raise exception using errcode='XX000',message='FAIL confirmou cancelada';
 exception when sqlstate 'P0001' then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.importar_nfe_xml(xml_nota);raise exception using errcode='XX000',message='FAIL não admin';
 exception when sqlstate 'P0001' then null;end;
end;$test$;
rollback;
select 'PASS: XML real com namespace, entidades, custos precisos, rascunho sem estoque, duplicidade, conversões pacote/ml, conferência, versão, atomicidade, retry, histórico, cancelamento e autorização. ROLLBACK.' resultado;
