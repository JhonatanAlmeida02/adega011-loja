import { test } from "node:test";
import assert from "node:assert/strict";
import { produtoVisivel } from "../../src/lib/visibilidade";
import { produtoDisponivel, type Produto } from "../../src/lib/tipos";
import { montarSecoes } from "../../src/lib/catalogo-secoes";

const p: Produto = { id:"sku", categoria_id:null, nome:"Produto", descricao:"", preco:1000, foto_url:null,
  destaque:false, disponivel:true, ativo:true, ordem:0, controla_estoque:true, estoque:0, visibilidade:"automatico" };
test("automático some ao esgotar e volta com entrada", () => {
  assert.equal(produtoVisivel(p),false);
  assert.equal(produtoVisivel({...p,estoque:1}),true);
  assert.equal(produtoVisivel({...p,estoque:0}),false);
});
test("respeita a quantidade por venda de garrafa e pacote", () => {
  assert.equal(produtoVisivel({...p,estoque:899,volume_unidade:900}),false);
  assert.equal(produtoVisivel({...p,estoque:900,volume_unidade:900}),true);
  assert.equal(produtoVisivel({...p,estoque:49,volume_unidade:50,vende_pacote:true}),false);
});
test("visível sem estoque continua bloqueado para venda; oculto não volta com entrada", () => {
  const visivel = {...p,visibilidade:"visivel" as const};
  assert.equal(produtoVisivel(visivel),true);
  assert.equal(produtoDisponivel(visivel),false);
  assert.equal(produtoVisivel({...p,visibilidade:"oculto",estoque:10}),false);
  assert.equal(produtoVisivel({...p,ativo:false,estoque:10}),false);
});
test("kits usam o saldo dos componentes, sem depender do saldo próprio", () => {
  assert.equal(produtoVisivel({...p,eh_kit:true,estoque:999,saldo_venda:0}),false);
  assert.equal(produtoVisivel({...p,eh_kit:true,saldo_venda:1}),true);
});
test("consumo próprio oculto por padrão e administrador pode forçar exibição", () => {
  assert.equal(produtoVisivel({...p,consumo_proprio:true,estoque:10}),false);
  assert.equal(produtoVisivel({...p,consumo_proprio:true,visibilidade:"visivel"}),true);
  assert.equal(produtoVisivel({...p,controla_estoque:false}),true);
});
test("vitrine, pesquisa e categorias contêm apenas os SKUs visíveis", () => {
  const produtos=[p,{...p,id:"com-saldo",estoque:1},{...p,id:"manual",visibilidade:"visivel" as const}];
  assert.deepEqual(montarSecoes([],produtos).flatMap(s=>s.produtos.map(v=>v.id)),["com-saldo","manual"]);
});
