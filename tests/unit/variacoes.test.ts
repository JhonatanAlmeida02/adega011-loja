import assert from "node:assert/strict";
import test from "node:test";
import { agruparVariacoes, textoBuscaProduto } from "../../src/lib/variacoes";
import { produtoDisponivel, type Produto } from "../../src/lib/tipos";
import { montarLinhas } from "../../src/lib/pedido";

const sku = (id: string, extra: Partial<Produto> = {}): Produto => ({
  id, nome: `Baly · ${id}`, descricao: "", preco: 1000, categoria_id: null,
  foto_url: null, destaque: false, disponivel: true, ativo: true, ordem: 0,
  estoque: 2, controla_estoque: true, familia_id: "baly", familia_nome: "Baly",
  variacao_atributo: "Sabor", variacao_nome: id, ...extra,
});

test("agrupa sabores sem alterar os SKUs nem seus saldos", () => {
  const melancia = sku("melancia"); const morango = sku("morango", { estoque: 0, preco: 500 });
  const grupo = agruparVariacoes([melancia, morango]);
  assert.equal(grupo.length, 1);
  assert.equal(grupo[0].nome, "Baly");
  assert.equal(grupo[0].preco, 1000); // menor preço entre opções vendáveis
  assert.equal(produtoDisponivel(grupo[0]), true);
  assert.deepEqual(grupo[0].variacoes, [melancia, morango]);
  assert.equal(morango.estoque, 0);
  assert.match(textoBuscaProduto(grupo[0]), /morango/);
});

test("grupo esgotado não fica disponível e produtos simples continuam separados", () => {
  const simples = sku("agua", { familia_id: null, estoque: 10 });
  const grupos = agruparVariacoes([sku("269", { estoque: 0 }), sku("350", { disponivel: false }), simples]);
  assert.equal(produtoDisponivel(grupos[0]), false);
  assert.equal(grupos[0].preco, 1000);
  assert.equal(grupos[1], simples);
});

test("carrinho e pedido mantêm preço, nome e saldo da variação escolhida", () => {
  const melancia = sku("melancia", { preco: 1200, estoque: 3 });
  const morango = sku("morango", { preco: 1300, estoque: 0 });
  const linhas = montarLinhas({ morango: { produtoId: morango.id, quantidade: 1, opcoes: [] } }, [melancia, morango]);
  assert.equal(linhas[0].produto.id, morango.id);
  assert.equal(linhas[0].produto.nome, "Baly · morango");
  assert.equal(linhas[0].unitario, 1300);
  assert.equal(linhas[0].indisponivel, true); // não usa o estoque da melancia
});
