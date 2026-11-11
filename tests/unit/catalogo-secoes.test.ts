import assert from "node:assert/strict";
import test from "node:test";
import { montarSecoes } from "../../src/lib/catalogo-secoes";
import type { Categoria, Produto } from "../../src/lib/tipos";
import { montarLinhas } from "../../src/lib/pedido";

const categoria: Categoria = { id: "cervejas", nome: "Cervejas", slug: "cervejas", ativa: true, ordem: 0 };
const sku = (id: string, extra: Partial<Produto> = {}): Produto => ({
  id, nome: `Skol · ${id} ml`, familia_id: "skol", familia_nome: "Skol", variacao_atributo: "Tamanho", variacao_nome: id,
  categoria_id: categoria.id, descricao: "", preco: 400, foto_url: `https://example.com/${id}.jpg`,
  estoque: 10, controla_estoque: true, ativo: true, disponivel: true, destaque: false, ordem: 0, ...extra,
});

test("vitrine mantém tamanhos separados com identidade, foto e preço próprios", () => {
  const pequena = sku("269", { ordem: 1 });
  const grande = sku("350", { ordem: 2, preco: 500 });
  const secoes = montarSecoes([categoria], [grande, pequena]);
  assert.deepEqual(secoes[0].produtos, [pequena, grande]);
  assert.equal(secoes[0].produtos[0].variacoes, undefined);
  const linhas = montarLinhas({ tamanho350: { produtoId: grande.id, quantidade: 1, opcoes: [] } }, secoes[0].produtos);
  assert.equal(linhas[0].produto.foto_url, "https://example.com/350.jpg");
  assert.equal(linhas[0].unitario, 500);
});

test("ocultar uma variação não oculta as outras; categoria inativa não aparece", () => {
  const visivel = sku("350");
  const oculto = sku("269", { ativo: false });
  assert.deepEqual(montarSecoes([categoria], [oculto, visivel])[0].produtos, [visivel]);
  assert.deepEqual(montarSecoes([{ ...categoria, ativa: false }], [visivel]), []);
});
