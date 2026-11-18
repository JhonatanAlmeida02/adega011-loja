import { test } from "node:test";
import assert from "node:assert/strict";
import { validarRelatorio } from "../../src/lib/relatorios";

const dados = {
  faturamento: 10000, pedidos: 2, ticket_medio: 5000, descontos: 0, taxas_entrega: 0,
  cancelados: 0, custo_produtos: 6000, vendas_sem_custo: 0, despesas: 1000,
  lucro_bruto: 4000, lucro_liquido: 3000, despesas_por_categoria: [],
  tarifas: 0, tarifas_por_forma: [],
  por_origem: [{ chave: "balcao", total: 10000, pedidos: 2 }],
  por_pagamento: [], por_dia: [], top_produtos: [],
};
test("relatório completo mantém valores reais, inclusive lucro negativo e período vazio", () => {
  assert.equal(validarRelatorio(dados).lucro_liquido, 3000);
  assert.equal(validarRelatorio({ ...dados, lucro_liquido: -1000 }).lucro_liquido, -1000);
  assert.equal(validarRelatorio({ ...dados, pedidos: 0, faturamento: 0 }).pedidos, 0);
});
test("formato antigo é rejeitado sem inventar custos/despesas zerados", () => {
  const { despesas_por_categoria: ignorado, ...antigo } = dados;
  void ignorado;
  assert.throws(() => validarRelatorio(antigo), /incompleto/);
});
test("tarifas de maquininha e Pix fazem parte do relatório (sem elas, é o formato antigo)", () => {
  const r = validarRelatorio({ ...dados, tarifas: 300, tarifas_por_forma: [{ chave: "Stone", pedidos: 1, total: 300 }] });
  assert.equal(r.tarifas, 300);
  const { tarifas: _t, tarifas_por_forma: _f, ...semTarifas } = dados;
  void _t; void _f;
  assert.throws(() => validarRelatorio(semTarifas), /incompleto/);
});
test("respostas nulas, listas inválidas e números ausentes não chegam à tela", () => {
  for (const invalido of [null, {}, { ...dados, despesas_por_categoria: null }, { ...dados, por_dia: [{}] }, { ...dados, lucro_liquido: undefined }, { ...dados, faturamento: NaN }]) {
    assert.throws(() => validarRelatorio(invalido), /incompleto/);
  }
});

test("custo por produto distingue zero de custo ausente e aceita a resposta anterior", () => {
  for (const custo of [0, 1250, null, undefined]) {
    const r = validarRelatorio({ ...dados, top_produtos: [{ nome: "Produto", quantidade: 5, total: 2500, custo }] });
    assert.equal(r.top_produtos[0].custo, custo);
  }
  assert.throws(() => validarRelatorio({ ...dados, top_produtos: [{ nome: "Produto", quantidade: 5, total: 2500, custo: "invalido" }] }), /incompleto/);
});
