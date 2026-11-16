import { test } from "node:test";
import assert from "node:assert/strict";
import { validarRelatorio } from "../../src/lib/relatorios";

const dados = {
  faturamento: 10000, pedidos: 2, ticket_medio: 5000, descontos: 0, taxas_entrega: 0,
  cancelados: 0, custo_produtos: 6000, vendas_sem_custo: 0, despesas: 1000,
  lucro_bruto: 4000, lucro_liquido: 3000, despesas_por_categoria: [],
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
test("respostas nulas, listas inválidas e números ausentes não chegam à tela", () => {
  for (const invalido of [null, {}, { ...dados, despesas_por_categoria: null }, { ...dados, por_dia: [{}] }, { ...dados, lucro_liquido: undefined }, { ...dados, faturamento: NaN }]) {
    assert.throws(() => validarRelatorio(invalido), /incompleto/);
  }
});
