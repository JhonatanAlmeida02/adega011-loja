-- Excluir ordem de entrada: pendente e cancelada saem de vez (com os itens) e o
-- mesmo XML pode ser importado de novo; lançada não sai; estoque nunca muda.
-- Rode: psql -v ON_ERROR_STOP=1 -f tests/sql/excluir_ordem_entrada.sql
begin;
set local statement_timeout = '25s';
do $test$
declare
  admin_id uuid := (select user_id from public.admins where papel = 'admin' limit 1);
  produto uuid := gen_random_uuid();
  chave text := '35261112345678000199550010000000771234567890';
  xml_nota text; ordem uuid; nova uuid; v integer; linhas jsonb; mov integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  insert into public.produtos (id, nome, preco, controla_estoque, unidade_estoque, volume_unidade, unidades_pacote)
  values (produto, 'QA Excluir OE', 500, true, 'un', 1, 1);
  xml_nota := format($xml$<?xml version="1.0" encoding="UTF-8"?>
 <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe%s" versao="4.00">
 <ide><mod>55</mod><nNF>77</nNF><serie>1</serie><dhEmi>2026-11-25T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
 <emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor QA</xNome></emit><dest><CNPJ>98765432000100</CNPJ></dest>
 <det nItem="1"><prod><cProd>QA-1</cProd><xProd>QA Excluir OE</xProd><uCom>UN</uCom><qCom>3.0000</qCom><vUnCom>2.00</vUnCom><vProd>6.00</vProd></prod></det>
 <total><ICMSTot><vNF>6.00</vNF></ICMSTot></total></infNFe></NFe>
 <protNFe><infProt><chNFe>%s</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>$xml$, chave, chave);
  select count(*) into mov from public.estoque_movimentos;

  -- Pendente: exclui de vez, itens juntos
  ordem := (public.importar_nfe_xml(xml_nota, 'a.xml') ->> 'id')::uuid;
  v := (select versao from public.ordens_entrada where id = ordem);
  begin
    perform public.excluir_ordem_entrada(ordem, v + 5);
    raise exception using errcode = 'XX000', message = 'FAIL versão velha';
  exception when sqlstate 'P0001' then null; end;
  perform public.excluir_ordem_entrada(ordem, v);
  if exists (select 1 from public.ordens_entrada where id = ordem) or exists (select 1 from public.ordens_entrada_itens where ordem_id = ordem) then raise exception 'FAIL pendente não saiu'; end if;

  -- O mesmo XML entra de novo (nova ordem); cancelada também pode ser excluída
  nova := (public.importar_nfe_xml(xml_nota, 'b.xml') ->> 'id')::uuid;
  if nova = ordem then raise exception 'FAIL reimportar'; end if;
  perform public.cancelar_ordem_entrada(nova, (select versao from public.ordens_entrada where id = nova));
  perform public.excluir_ordem_entrada(nova, (select versao from public.ordens_entrada where id = nova));
  if exists (select 1 from public.ordens_entrada where id = nova) then raise exception 'FAIL cancelada não saiu'; end if;

  -- Lançada: não exclui
  ordem := (public.importar_nfe_xml(xml_nota, 'c.xml') ->> 'id')::uuid;
  select jsonb_agg(to_jsonb(t) || jsonb_build_object('produto_id', produto, 'fator', 1, 'unidade_estoque', 'un', 'conferido', true))
    into linhas from public.ordens_entrada_itens t where ordem_id = ordem;
  v := public.salvar_ordem_entrada(ordem, (select versao from public.ordens_entrada where id = ordem), linhas, '');
  perform public.confirmar_ordem_entrada(ordem, v);
  if (select status from public.ordens_entrada where id = ordem) <> 'lancada' then raise exception 'FAIL lançar'; end if;
  begin
    perform public.excluir_ordem_entrada(ordem, (select versao from public.ordens_entrada where id = ordem));
    raise exception using errcode = 'XX000', message = 'FAIL excluiu lançada';
  exception when sqlstate 'P0001' then null; end;
  if (select count(*) from public.estoque_movimentos) <> mov + 1 or (select estoque from public.produtos where id = produto) <> 3 then raise exception 'FAIL estoque'; end if;

  -- Quem não é admin não exclui
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.excluir_ordem_entrada(gen_random_uuid(), 1);
    raise exception using errcode = 'XX000', message = 'FAIL não admin';
  exception when sqlstate 'P0001' then null; end;
end;
$test$;
rollback;
select 'PASS: ordem pendente e cancelada excluídas de vez (com itens), XML importável de novo, lançada não sai, estoque intacto, só admin. Dados desfeitos.' as resultado;
