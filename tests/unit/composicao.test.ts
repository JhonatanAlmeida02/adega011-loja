import { strict as assert } from "node:assert";
import { test } from "node:test";
import { aplicarComposicao, type Produto } from "../../src/lib/tipos";

const base = (id: string, extra: Partial<Produto> = {}): Produto => ({
  id, categoria_id: null, nome: id, descricao: "", preco: 100, foto_url: null, destaque: false,
  disponivel: true, ativo: true, ordem: 0, controla_estoque: false, estoque: 0, ...extra,
});

test("junta itens do kit e fotos das escolhas", () => {
  const kit = base("kit", {
    grupos: [{ id: "g", produto_id: "kit", nome: "Energético", minimo: 0, maximo: 1, ordem: 0,
      opcoes: [
        { id: "o1", grupo_id: "g", nome: "Red Bull", preco: 500, disponivel: true, ordem: 0 },
        { id: "o2", grupo_id: "g", nome: "Sem energético", preco: 0, disponivel: true, ordem: 1 },
      ] }],
  });
  const [r, simples] = aplicarComposicao([kit, base("simples")], [
    { tipo: "kit", dono_id: "kit", nome: "Vodka", foto_url: "/v.svg", quantidade: 1 },
    { tipo: "kit", dono_id: "kit", nome: "Lata", foto_url: null, quantidade: 2 },
    { tipo: "opcao", dono_id: "o1", nome: "Red Bull 250 ml", foto_url: "/rb.svg", quantidade: null },
  ]);
  assert.deepEqual(r.composicao?.map((i) => `${i.quantidade}x ${i.nome}`), ["1x Vodka", "2x Lata"]);
  assert.equal(r.grupos?.[0].opcoes[0].foto_url, "/rb.svg");
  assert.equal(r.grupos?.[0].opcoes[1].foto_url, undefined);
  assert.equal(simples.composicao, undefined);
});

test("sem linhas, devolve os produtos como estão", () => {
  const lista = [base("a")];
  assert.equal(aplicarComposicao(lista, []), lista);
});
