import assert from "node:assert/strict";
import test from "node:test";
import { aplicarSaldos, controlaSaldo, produtoDisponivel, saldoVendavel, type Produto } from "../../src/lib/tipos";
import { montarLinhas } from "../../src/lib/pedido";

const produto = (campos: Partial<Produto> = {}): Produto => ({
  id: "base", categoria_id: null, nome: "Base", descricao: "", preco: 400, foto_url: null,
  destaque: false, disponivel: true, ativo: true, ordem: 0, controla_estoque: true, estoque: 31,
  ...campos,
});

test("unidades continuam usando o saldo original", () => {
  assert.equal(saldoVendavel(produto()), 31);
  assert.equal(produtoDisponivel(produto({ estoque: 0 })), false);
});

test("uma garrafa de 900 ml consome uma unidade de venda inteira", () => {
  const p = produto({ unidade_estoque: "ml", volume_unidade: 900, estoque: 1800 });
  assert.equal(saldoVendavel(p), 2);
  assert.equal(saldoVendavel({ ...p, estoque: 899 }), 0);
  assert.equal(produtoDisponivel({ ...p, estoque: 100 }), false);
});

test("kit usa o saldo calculado dos componentes e nunca o estoque próprio", () => {
  const kit = produto({ eh_kit: true, controla_estoque: false, estoque: 0, saldo_venda: 9 });
  assert.equal(controlaSaldo(kit), true);
  assert.equal(saldoVendavel(kit), 9);
  assert.equal(produtoDisponivel(kit), true);
  assert.equal(produtoDisponivel({ ...kit, saldo_venda: undefined }), false);
  assert.equal(produtoDisponivel({ ...kit, saldo_venda: 0 }), false);
});

test("saldos são unidos pelo identificador e mantêm dados e adicionais", () => {
  const p = produto({ eh_kit: true, grupos: [] });
  const [atual] = aplicarSaldos([p], [{ produto_id: "base", saldo: 2 }]);
  assert.equal(atual.saldo_venda, 2);
  assert.deepEqual(atual.grupos, []);
  assert.equal(p.saldo_venda, undefined);
});

test("carrinho bloqueia kit sem componentes suficientes", () => {
  const salvo = { linha: { produtoId: "base", opcoes: [], quantidade: 1 } };
  const kit = produto({ eh_kit: true, controla_estoque: false, saldo_venda: 0 });
  assert.equal(montarLinhas(salvo, [kit])[0].indisponivel, true);
  assert.equal(montarLinhas(salvo, [{ ...kit, saldo_venda: 1 }])[0].indisponivel, false);
});

test("produtos sem controle continuam disponíveis e flag manual prevalece", () => {
  assert.equal(produtoDisponivel(produto({ controla_estoque: false, estoque: 0 })), true);
  assert.equal(produtoDisponivel(produto({ eh_kit: true, saldo_venda: 99, disponivel: false })), false);
});


test("pacote de 50 com 248 folhas permite quatro vendas e bloqueia um pacote incompleto", () => {
  const pacote = produto({ estoque: 248, unidades_pacote: 50, vende_pacote: true, volume_unidade: 50 });
  assert.equal(saldoVendavel(pacote), 4);
  assert.equal(produtoDisponivel({ ...pacote, estoque: 49 }), false);
  assert.equal(produtoDisponivel({ ...pacote, estoque: 50 }), true);
  const avulsa = { ...pacote, vende_pacote: false, volume_unidade: 1 };
  assert.equal(saldoVendavel(avulsa), 248);
});
