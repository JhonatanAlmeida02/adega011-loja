import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("clonagem copia fotos independentemente, preserva tentativas e seleciona o escopo", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://clonagem.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "qa-key";
  const raiz = "https://clonagem.supabase.test/storage/v1/object/public/produtos/";
  const a = { id: "a", familia_id: "f", foto_url: `${raiz}produtos/original.webp` };
  const b = { id: "b", familia_id: "f", foto_url: `${raiz}produtos/uva.png` };
  const copias: { sourceKey: string; destinationKey: string }[] = [];
  const pedidos: { p_novo: string; p_origem: string; p_incluir_variacoes: boolean; p_fotos: Record<string, string> }[] = [];
  let falharRpc = true;
  let falharFoto = false;
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname.endsWith("/produtos")) {
      return Response.json(url.searchParams.has("id") ? a : [a, b]);
    }
    if (url.pathname.endsWith("/object/copy")) {
      if (falharFoto) return Response.json({ message: "Foto indisponível" }, { status: 400 });
      copias.push(await req.json());
      return Response.json({ Key: "produtos/copia" });
    }
    if (url.pathname.endsWith("/rpc/clonar_produto")) {
      const pedido = await req.json();
      pedidos.push(pedido);
      if (falharRpc) return Response.json({ message: "Falha de teste", code: "P0001" }, { status: 400 });
      return Response.json(pedido.p_novo);
    }
    throw new Error(`Requisição inesperada: ${url.pathname}`);
  });
  try {
    const { clonarProduto } = await import("../../src/lib/admin/clonar-produto");
    const pedido = { id: crypto.randomUUID(), fotos: {} as Record<string, string> };
    await assert.rejects(clonarProduto("a", true, pedido), /Falha de teste/);
    assert.equal(copias.length, 2);
    assert.equal(copias[0].sourceKey, "produtos/original.webp");
    assert.match(copias[0].destinationKey, new RegExp(`produtos/clones/${pedido.id}/.*\\.webp$`));
    assert.notEqual(pedido.fotos.a, a.foto_url);
    assert.notEqual(pedido.fotos.b, b.foto_url);
    falharRpc = false;
    assert.equal(await clonarProduto("a", true, pedido), pedido.id);
    assert.equal(copias.length, 2, "retry deve reutilizar as fotos já copiadas");
    assert.deepEqual(pedidos[0], pedidos[1], "retry deve manter o identificador e as fotos");
    const individual = { id: crypto.randomUUID(), fotos: {} };
    await clonarProduto("a", false, individual);
    assert.equal(copias.length, 3, "variação individual copia só a própria foto");
    assert.equal(pedidos[2].p_incluir_variacoes, false);
    falharFoto = true;
    await assert.rejects(clonarProduto("a", false, { id: crypto.randomUUID(), fotos: {} }), /copiar a foto/);
    assert.equal(pedidos.length, 3, "não cria cadastro incompleto quando a foto falha");
  } finally {
    fetchMock.mock.restore();
  }
});
