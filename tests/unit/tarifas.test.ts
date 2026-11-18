import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularTarifa, formatarPercentual, paraPontosBase, pontosBaseParaCampo, tarifaDaVenda, type TarifasPagamento } from "../../src/lib/tarifas";

test("porcentagem digitada vira pontos-base e volta igual", () => {
  assert.equal(paraPontosBase("10"), 1000);
  assert.equal(paraPontosBase("2,99"), 299);
  assert.equal(paraPontosBase("0.99%"), 99);
  assert.equal(paraPontosBase(""), 0);
  assert.equal(paraPontosBase("100"), 10000);
  for (const ruim of ["101", "-1", "abc", "2,999", "1,2,3"]) assert.equal(paraPontosBase(ruim), null, ruim);
  assert.equal(pontosBaseParaCampo(299), "2,99");
  assert.equal(pontosBaseParaCampo(1000), "10");
  assert.equal(pontosBaseParaCampo(250), "2,5");
  assert.equal(formatarPercentual(0), "0%");
});

test("R$ 100 com 10% → tarifa R$ 10 (loja recebe R$ 90); arredonda como o banco", () => {
  assert.equal(calcularTarifa(10000, 1000), 1000);
  assert.equal(calcularTarifa(1050, 299), 31); // 31,395 → 31
  assert.equal(calcularTarifa(1000, 10000), 1000);
  assert.equal(calcularTarifa(0, 500), 0);
});

test("cartão usa a maquininha escolhida ou a padrão; Pix usa a taxa do Pix; dinheiro não tem taxa", () => {
  const t: TarifasPagamento = { pix_bp: 99, maquininhas: [{ id: "a", nome: "Stone", taxa_bp: 299, padrao: false }, { id: "b", nome: "Cielo", taxa_bp: 1000, padrao: true }] };
  assert.equal(tarifaDaVenda(t, "cartao", "a").bp, 299);
  assert.equal(tarifaDaVenda(t, "cartao", null).maquininha?.nome, "Cielo");
  assert.equal(tarifaDaVenda(t, "pix", "a").bp, 99);
  assert.equal(tarifaDaVenda(t, "dinheiro", "a").bp, 0);
  assert.equal(tarifaDaVenda(null, "cartao", "a").bp, 0);
});
