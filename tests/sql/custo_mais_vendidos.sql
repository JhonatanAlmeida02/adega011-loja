begin;
do $$
declare admin_id uuid; simples uuid:=gen_random_uuid(); bebida uuid:=gen_random_uuid(); energetico uuid:=gen_random_uuid();
  kit uuid:=gen_random_uuid(); gratuito uuid:=gen_random_uuid(); sem_custo uuid:=gen_random_uuid(); grupo uuid:=gen_random_uuid(); opcao uuid:=gen_random_uuid();
  pedido uuid:=gen_random_uuid(); r jsonb; linha jsonb;
begin
  select user_id into admin_id from public.admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  insert into public.produtos(id,nome,preco,controla_estoque,unidade_estoque,volume_unidade,eh_kit)
    values(simples,'QA CUSTO SIMPLES',500,false,'un',1,false),
      (bebida,'QA CUSTO BEBIDA',2200,true,'ml',900,false),
      (energetico,'QA CUSTO ENERGETICO',1000,true,'ml',2000,false),
      (kit,'QA CUSTO KIT',1000,false,'un',1,true),
      (gratuito,'QA CUSTO ZERO',100,false,'un',1,false),
      (sem_custo,'QA CUSTO AUSENTE',100,false,'un',1,false);
  insert into public.produto_importacao(produto_id,codigo,custo,origem) values
    (simples,'QA-'||simples::text,250,'{}'),(bebida,'QA-'||bebida::text,1800,'{}'),
    (energetico,'QA-'||energetico::text,1000,'{}'),(gratuito,'QA-'||gratuito::text,0,'{}');
  insert into public.kit_componentes(kit_id,componente_id,quantidade) values(kit,bebida,100);
  insert into public.grupos_opcoes(id,produto_id,nome,minimo,maximo) values(grupo,kit,'QA ENERGETICO',0,1);
  insert into public.opcoes(id,grupo_id,nome,preco,componente_id,quantidade_consumo) values(opcao,grupo,'QA OPCAO',0,energetico,400);
  insert into public.pedidos(id,numero,criado_em,status,cliente_nome,cliente_telefone,tipo,pagamento,itens,subtotal,total,origem)
    overriding system value values(pedido,-990000005,'2000-01-15 12:00:00-03','concluido','QA RELATORIO','11900000000','balcao','pix',
      jsonb_build_array(
        jsonb_build_object('produto_id',simples,'nome','QA CUSTO SIMPLES','quantidade',3,'preco',500),
        jsonb_build_object('produto_id',kit,'nome','QA CUSTO KIT','quantidade',2,'preco',1000,'opcoes',jsonb_build_array(jsonb_build_object('id',opcao))),
        jsonb_build_object('produto_id',gratuito,'nome','QA CUSTO ZERO','quantidade',5,'preco',100),
        jsonb_build_object('produto_id',sem_custo,'nome','QA CUSTO AUSENTE','quantidade',2,'preco',100)
      ),4200,4200,'balcao');
  r:=public.relatorio_vendas('2000-01-15','2000-01-15');
  select e into linha from jsonb_array_elements(r->'top_produtos')e where e->>'nome'='QA CUSTO SIMPLES';
  if (linha->>'custo')::integer is distinct from 750 or (linha->>'quantidade')::integer<>3 or (linha->>'total')::integer<>1500 then raise exception 'FAIL simple cost is not quantity x unit cost';end if;
  select e into linha from jsonb_array_elements(r->'top_produtos')e where e->>'nome'='QA CUSTO KIT';
  if (linha->>'custo')::integer is distinct from 800 then raise exception 'FAIL kit/ml/options cost';end if;
  select e into linha from jsonb_array_elements(r->'top_produtos')e where e->>'nome'='QA CUSTO ZERO';
  if (linha->>'custo')::integer is distinct from 0 then raise exception 'FAIL zero cost treated as unknown';end if;
  select e into linha from jsonb_array_elements(r->'top_produtos')e where e->>'nome'='QA CUSTO AUSENTE';
  if not(linha ? 'custo') or linha->>'custo' is not null then raise exception 'FAIL unknown cost invented';end if;
  if (r->>'custo_produtos')::integer<>1550 then raise exception 'FAIL total report cost changed';end if;
end;$$;
rollback;
select 'PASS: cost totals per product, quantities, kit recipes, ml, selected extras, zero and unknown costs. Fixtures rolled back.' as resultado;
