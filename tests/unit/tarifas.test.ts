import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularTarifa, formatarPercentual, maquininhaInicial, paraPontosBase, pontosBaseParaCampo, tarifaDaVenda, type TarifasPagamento } from "../../src/lib/tarifas";

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

test("cartão: maquininha escolhida (ou a padrão do PDV) com a taxa de débito ou crédito; Pix e dinheiro", () => {
  const t: TarifasPagamento = { pix_bp: 99, maquininhas: [
    { id: "a", nome: "Stone", taxa_debito_bp: 137, taxa_credito_bp: 299, padrao_pdv: false, padrao_site: true },
    { id: "b", nome: "Cielo", taxa_debito_bp: 200, taxa_credito_bp: 1000, padrao_pdv: true, padrao_site: false },
  ] };
  assert.equal(tarifaDaVenda(t, "cartao", "a", "debito").bp, 137);
  assert.equal(tarifaDaVenda(t, "cartao", "a", "credito").bp, 299);
  assert.equal(tarifaDaVenda(t, "cartao", null, "credito").maquininha?.nome, "Cielo");
  assert.equal(tarifaDaVenda(t, "cartao", "a", null).bp, 0); // ainda não escolheu débito/crédito
  assert.equal(tarifaDaVenda(t, "pix", "a", "debito").bp, 99);
  assert.equal(tarifaDaVenda(t, "dinheiro", "a", "credito").bp, 0);
  assert.equal(tarifaDaVenda(null, "cartao", "a", "credito").bp, 0);
  assert.equal(maquininhaInicial(t.maquininhas)?.id, "b");
  assert.equal(maquininhaInicial([{ ...t.maquininhas[0] }])?.id, "a");
  assert.equal(maquininhaInicial([]), null);
});
