import { test } from "node:test";
import assert from "node:assert/strict";
import { itensDaCobranca } from "../../supabase/functions/pix/itens";

const copao = { produto_id: "p1", nome: "COPÃO WHISKY CAVALO BRANCO", preco: 2800, quantidade: 2, opcoes: [{ nome: "Baly · TRADICIONAL" }, { nome: "Licor de framboesa" }] };
const skol = { produto_id: "p2", nome: "CERVEJA LATA SKOL · 269ML", preco: 400, quantidade: 3, opcoes: [] };

test("itens com quantidade, preço unitário (com adicionais) e taxa de entrega", () => {
  const itens = itensDaCobranca({ total: 2 * 2800 + 3 * 400 + 595, taxa: 595, itens: [copao, skol] });
  assert.deepEqual(itens, [
    { title: "COPÃO WHISKY CAVALO BRANCO (Baly · TRADICIONAL, Licor de framboesa)", unit_price: "28.00", quantity: 2, external_code: "p1" },
    { title: "CERVEJA LATA SKOL · 269ML", unit_price: "4.00", quantity: 3, external_code: "p2" },
    { title: "Taxa de entrega", unit_price: "5.95", quantity: 1, external_code: "entrega" },
  ]);
});

test("soma diferente do total, desconto ou lista vazia: cobrança sem itens", () => {
  assert.equal(itensDaCobranca({ total: 9999, itens: [skol] }), null);
  assert.equal(itensDaCobranca({ total: 1200, desconto: 100, itens: [skol] }), null);
  assert.equal(itensDaCobranca({ total: 1200, itens: [] }), null);
  assert.equal(itensDaCobranca({ total: 0, itens: [{ ...skol, quantidade: 0, preco: 0 }] }), null);
});
