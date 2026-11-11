import test from "node:test";
import assert from "node:assert/strict";
import { aplicarSaldos, type Produto } from "../../src/lib/tipos";
import { montarLinhas } from "../../src/lib/pedido";

const copao: Produto = { id: "copao", nome: "Copão", preco: 1000, descricao: "", foto_url: null, categoria_id: null,
  ativo: true, disponivel: true, destaque: false, ordem: 0, eh_kit: true, estoque: 0, controla_estoque: false,
  grupos: [{ id: "energia", produto_id: "copao", nome: "Energético", minimo: 1, maximo: 1, ordem: 0, opcoes: [
    { id: "long", grupo_id: "energia", nome: "Long Night", preco: 0, disponivel: true, ordem: 0 },
    { id: "baly", grupo_id: "energia", nome: "Baly", preco: 300, disponivel: true, ordem: 1 },
  ] }],
};
test("estoque das escolhas bloqueia só o energético esgotado e preserva preço zero/+3", () => {
  const [p] = aplicarSaldos([copao], [{ produto_id: "copao", saldo: 2 }], [{ opcao_id: "long", saldo: 2 }, { opcao_id: "baly", saldo: 0 }]);
  const linhas = montarLinhas({ a: { produtoId: "copao", quantidade: 1, opcoes: ["long"] }, b: { produtoId: "copao", quantidade: 1, opcoes: ["baly"] } }, [p]);
  assert.equal(linhas[0].unitario, 1000);
  assert.equal(linhas[0].indisponivel, false);
  assert.equal(linhas[1].unitario, 1300);
  assert.equal(linhas[1].indisponivel, true);
  assert.equal(copao.grupos![0].opcoes[1].disponivel, true);
});
