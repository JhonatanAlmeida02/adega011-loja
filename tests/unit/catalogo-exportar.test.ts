import { test } from "node:test";
import assert from "node:assert/strict";
import { contarItens, montarCatalogo, ordenarSecoes, planilhaCatalogo, precosIguais } from "../../src/lib/catalogo-exportar";
import type { Secao } from "../../src/lib/catalogo-secoes";
import type { Produto } from "../../src/lib/tipos";

const base = { descricao: "", foto_url: null, destaque: false, disponivel: true, ativo: true, ordem: 0, controla_estoque: false, estoque: 0, categoria_id: "c" } as const;
const p = (id: string, nome: string, preco: number, extra: Partial<Produto> = {}): Produto => ({ ...base, id, nome, preco, ...extra }) as Produto;

const secoes: Secao[] = [
  { id: "cervejas", nome: "Cervejas", produtos: [], grupos: [{ id: "cervejas", nome: null, produtos: [
    p("ipa", "IPA 473 ml", 1490, { descricao: 'Lupulada; "gelada"' }),
    p("esg", "Pilsen", 590, { controla_estoque: true, estoque: 0 }),
  ] }] },
  { id: "tabacaria", nome: "Tabacaria", produtos: [], grupos: [{ id: "cigarros", nome: "Cigarros", produtos: [
    p("az", "Rothmans Azul", 1000, { familia_id: "f", familia_nome: "Rothmans", variacao_nome: "Azul", variacao_atributo: "Cor" }),
    p("vm", "Rothmans Vermelho", 1000, { familia_id: "f", familia_nome: "Rothmans", variacao_nome: "Vermelho", variacao_atributo: "Cor", disponivel: false }),
    p("pend", "Sem preço", 0, { preco_pendente: true }),
  ] }] },
];

test("variações viram um item só; só disponíveis tira o esgotado (e a variação esgotada)", () => {
  const tudo = montarCatalogo(secoes, { secoes: null, soDisponiveis: false, separarVariacoes: false });
  assert.equal(contarItens(tudo), 3); // IPA, Pilsen, Rothmans (preço pendente fica de fora)
  const rothmans = tudo[1].grupos[0].itens[0];
  assert.equal(rothmans.nome, "Rothmans");
  assert.deepEqual(rothmans.variacoes.map((v) => v.nome), ["Azul", "Vermelho"]);
  assert.equal(precosIguais(rothmans), true);
  assert.equal(tudo[1].grupos[0].nome, "Cigarros");

  const disponiveis = montarCatalogo(secoes, { secoes: null, soDisponiveis: true, separarVariacoes: false });
  assert.deepEqual(disponiveis[0].grupos[0].itens.map((i) => i.nome), ["IPA 473 ml"]);
  assert.deepEqual(disponiveis[1].grupos[0].itens[0].variacoes.map((v) => v.nome), ["Azul"]);
});

test("escolher categorias", () => {
  const so = montarCatalogo(secoes, { secoes: new Set(["tabacaria"]), soDisponiveis: false });
  assert.deepEqual(so.map((s) => s.nome), ["Tabacaria"]);
  assert.equal(contarItens(montarCatalogo(secoes, { secoes: new Set(), soDisponiveis: false })), 0);
});

test("planilha para Excel: BOM, ponto e vírgula, vírgula decimal, aspas e uma linha por SKU", () => {
  const csv = planilhaCatalogo(montarCatalogo(secoes, { secoes: null, soDisponiveis: false, separarVariacoes: false }), new Map([["ipa", "IPA-473"]]));
  assert.ok(csv.startsWith("﻿Categoria;Subcategoria;Produto;Variação;SKU;Preço (R$);Disponível;Descrição\r\n"));
  const linhas = csv.trim().split("\r\n");
  assert.equal(linhas.length, 1 + 4);
  assert.equal(linhas[1], 'Cervejas;;IPA 473 ml;;IPA-473;14,90;Sim;"Lupulada; ""gelada"""');
  assert.equal(linhas[2], "Cervejas;;Pilsen;;;5,90;Não;");
  assert.equal(linhas[4], "Tabacaria;Cigarros;Rothmans;Vermelho;;10,00;Não;");
  // Texto que começa com "=" não vira fórmula
  const perigoso = planilhaCatalogo(montarCatalogo([{ ...secoes[0], grupos: [{ id: "x", nome: null, produtos: [p("x", "=SOMA(1)", 100)] }] }], { secoes: null, soDisponiveis: false, separarVariacoes: false }), new Map());
  assert.ok(perigoso.includes(";'=SOMA(1);"));
});

test("variações separadas (padrão): cada sabor no seu cartão, com o nome completo e a foto da família", () => {
  const sep = montarCatalogo(secoes, { secoes: null, soDisponiveis: false });
  assert.deepEqual(sep[1].grupos[0].itens.map((i) => i.nome), ["Rothmans Azul", "Rothmans Vermelho"]);
  assert.equal(contarItens(sep), 4);
  // Nome sem a variação ganha "Família · Variação"
  const curto = montarCatalogo([{ id: "x", nome: "X", produtos: [], grupos: [{ id: "x", nome: null, produtos: [
    p("m", "Melancia", 1500, { familia_id: "b", familia_nome: "Baly 2L", variacao_nome: "Melancia", foto_url: null }),
    p("v", "Baly 2L · Maçã Verde", 1500, { familia_id: "b", familia_nome: "Baly 2L", variacao_nome: "Maçã Verde", foto_url: "/f.webp" }),
  ] }] }], { secoes: null, soDisponiveis: false });
  assert.deepEqual(curto[0].grupos[0].itens.map((i) => [i.nome, i.foto]), [["Baly 2L · Melancia", "/f.webp"], ["Baly 2L · Maçã Verde", "/f.webp"]]);
  // Só disponíveis tira o sabor esgotado
  assert.deepEqual(montarCatalogo(secoes, { secoes: null, soDisponiveis: true })[1].grupos[0].itens.map((i) => i.nome), ["Rothmans Azul"]);
});

test("ordem das categorias só do catálogo (as novas vão para o fim)", () => {
  assert.deepEqual(montarCatalogo(secoes, { secoes: null, soDisponiveis: false, ordem: ["tabacaria", "cervejas"] }).map((s) => s.id), ["tabacaria", "cervejas"]);
  const lista = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(ordenarSecoes(lista, ["c", "a", "sumiu"]).map((s) => s.id), ["c", "a", "b", "d"]);
  assert.deepEqual(ordenarSecoes(lista, null).map((s) => s.id), ["a", "b", "c", "d"]);
});

test("planilha com variações separadas: produto da família e a variação na coluna própria", () => {
  const csv = planilhaCatalogo(montarCatalogo(secoes, { secoes: null, soDisponiveis: false }), new Map());
  assert.ok(csv.includes("Tabacaria;Cigarros;Rothmans;Azul;;10,00;Sim;"));
  assert.ok(csv.includes("Tabacaria;Cigarros;Rothmans;Vermelho;;10,00;Não;"));
});
