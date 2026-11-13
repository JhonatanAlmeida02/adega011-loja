import assert from "node:assert/strict";
import test from "node:test";
import { decodificarXml, LIMITE_XML, pendenciaEntrada, quantidadeEntrada, sugerirFator, type ItemEntrada } from "../../src/lib/ordens-entrada";
import type { Produto } from "../../src/lib/tipos";

const produto = { id: "produto", nome: "Baly 2L", eh_kit: false, controla_estoque: true, unidade_estoque: "ml", volume_unidade: 2000, unidades_pacote: 1 } as Produto;
const item = { conferido: true, ignorar: false, produto_id: produto.id, unidade_estoque: "ml", quantidade_recebida: 10, fator: 2000, custo_conferido: 12 } as ItemEntrada;
test("entrada converte pacotes, garrafas e litros fracionados sem aceitar saldo fracionado", () => {
  assert.equal(quantidadeEntrada({ quantidade_recebida: 10, fator: 50 }), 500);
  assert.equal(quantidadeEntrada(item), 20000);
  assert.equal(quantidadeEntrada({ quantidade_recebida: 0.5, fator: 1000 }), 500);
  assert.equal(quantidadeEntrada({ quantidade_recebida: 0.1, fator: 3 }), null);
  assert.equal(quantidadeEntrada({ quantidade_recebida: null, fator: 1 }), null);
  for (const v of [NaN, Infinity, -1, 0, 1_000_000_001]) assert.equal(quantidadeEntrada({ quantidade_recebida: v, fator: 1 }), null);
});
test("conferência exige produto, unidade atual e custo; ignorados também precisam ser conferidos", () => {
  assert.equal(pendenciaEntrada(item, produto), null);
  assert.ok(pendenciaEntrada({ ...item, conferido: false }, produto));
  assert.ok(pendenciaEntrada({ ...item, unidade_estoque: "un" }, produto));
  assert.ok(pendenciaEntrada({ ...item, custo_conferido: NaN }, produto));
  assert.ok(pendenciaEntrada(item, { ...produto, eh_kit: true }));
  assert.ok(pendenciaEntrada(item));
  assert.equal(pendenciaEntrada({ ...item, ignorar: true }), null);
  assert.ok(pendenciaEntrada({ ...item, ignorar: true, conferido: false }));
});
test("sugestões distinguem ml, litro, garrafa e pacote sem inventar conteúdo da caixa", () => {
  assert.equal(sugerirFator("UN", produto), 2000);
  assert.equal(sugerirFator("L", produto), 1000);
  assert.equal(sugerirFator("ML", produto), 1);
  assert.equal(sugerirFator("CX", produto), null);
  const pacote = { ...produto, unidade_estoque: "un", unidades_pacote: 50, vende_pacote: true } as Produto;
  assert.equal(sugerirFator("UN", pacote), 50);
  assert.equal(sugerirFator("UN", { ...pacote, vende_pacote: false }), 1);
  assert.equal(sugerirFator("PCT", pacote), null);
});
test("XML aceita UTF-8 e Latin-1, recusa arquivos grandes e DTD/entidades", () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><nfe>Maçã &amp; Coco</nfe>';
  assert.equal(decodificarXml(new TextEncoder().encode(xml)), xml);
  const latin = '<?xml version="1.0" encoding="ISO-8859-1"?><nfe>Maçã</nfe>';
  assert.equal(decodificarXml(Uint8Array.from([...latin].map((c) => c.charCodeAt(0)))), latin);
  assert.throws(() => decodificarXml(new Uint8Array(LIMITE_XML + 1)));
  assert.throws(() => decodificarXml(new Uint8Array()));
  assert.throws(() => decodificarXml(new TextEncoder().encode('<!DOCTYPE x [<!ENTITY x SYSTEM "http://example.com/">]><x/>')));
  assert.throws(() => decodificarXml(new TextEncoder().encode('<?xml encoding="UTF-16"?><x/>')));
});
