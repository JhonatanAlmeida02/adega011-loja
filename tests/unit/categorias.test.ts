import { test } from "node:test";
import assert from "node:assert/strict";
import { idsDaCategoria, ordenarArvore, rotuloCategoria } from "../../src/lib/categorias";
import { montarSecoes } from "../../src/lib/catalogo-secoes";
import type { Categoria, Produto } from "../../src/lib/tipos";

const cat = (id: string, nome: string, ordem: number, pai_id: string | null = null, ativa = true): Categoria =>
  ({ id, nome, slug: nome.toLowerCase(), ordem, ativa, pai_id });
const prod = (id: string, categoria_id: string | null, ordem = 0): Produto => ({
  id, nome: id, descricao: "", preco: 100, foto_url: null, categoria_id, destaque: false, disponivel: true,
  ativo: true, ordem, controla_estoque: false, estoque: 0,
});

const cats = [
  cat("cerv", "Cervejas", 0),
  cat("gin", "Gin", 5, "dest"),
  cat("dest", "Destilados", 1),
  cat("vod", "Vodka", 3, "dest"),
  cat("orfa", "Órfã", 9, "nao-existe"),
];

test("árvore: principal seguida das subcategorias, na ordem", () => {
  assert.deepEqual(ordenarArvore(cats).map((c) => `${c.nivel}:${c.id}`), ["0:cerv", "0:dest", "1:vod", "1:gin", "0:orfa"]);
});

test("rótulo com a principal e filtro que inclui as subcategorias", () => {
  assert.equal(rotuloCategoria(cats[1], cats), "Destilados › Gin");
  assert.equal(rotuloCategoria(cats[0], cats), "Cervejas");
  assert.equal(rotuloCategoria(cats[4], cats), "Órfã");
  assert.deepEqual([...idsDaCategoria("dest", cats)].sort(), ["dest", "gin", "vod"]);
});

test("vitrine: subcategorias viram grupos dentro da seção principal", () => {
  const secoes = montarSecoes(cats, [prod("p-dest", "dest"), prod("p-gin", "gin"), prod("p-vod", "vod"), prod("p-cerv", "cerv"), prod("p-sem", null)]);
  assert.deepEqual(secoes.map((s) => s.id), ["cervejas", "destilados", "outros"]);
  const dest = secoes[1];
  assert.deepEqual(dest.produtos.map((p) => p.id), ["p-dest", "p-vod", "p-gin"]);
  assert.deepEqual(dest.grupos.map((g) => `${g.nome ?? "-"}:${g.produtos.map((p) => p.id).join(",")}`), ["-:p-dest", "Vodka:p-vod", "Gin:p-gin"]);
  assert.equal(secoes[0].grupos.length, 1);
});

test("vitrine: subcategoria oculta (ou principal oculta) esconde os produtos", () => {
  const ocultas = cats.map((c) => (c.id === "gin" ? { ...c, ativa: false } : c));
  assert.deepEqual(montarSecoes(ocultas, [prod("p-gin", "gin"), prod("p-vod", "vod")])[0].produtos.map((p) => p.id), ["p-vod"]);
  const principalOculta = cats.map((c) => (c.id === "dest" ? { ...c, ativa: false } : c));
  assert.equal(montarSecoes(principalOculta, [prod("p-gin", "gin")]).length, 0);
  // Só com produtos nas subcategorias a seção principal aparece mesmo assim
  assert.deepEqual(montarSecoes(cats, [prod("p-gin", "gin")]).map((s) => s.id), ["destilados"]);
});
