import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMADAS as CAMADAS_FUNCAO, extrairTema, lerLinkFigma, type NoFigma } from "../../supabase/functions/catalogo-figma/extrair";
import { CAMADAS, linksFontes, normalizarTema, TEMA_PADRAO } from "../../src/lib/catalogo-tema";
import { escaparXml, gerarFolhaSvg, quebrarTexto } from "../../src/lib/catalogo-svg";
import type { SecaoCatalogo } from "../../src/lib/catalogo-exportar";

const solido = (r: number, g: number, b: number) => [{ type: "SOLID", color: { r, g, b, a: 1 } }];
const texto = (name: string, fontFamily: string, fontWeight: number, fontSize: number, cor = solido(0, 0, 0)): NoFigma =>
  ({ name, type: "TEXT", fills: cor, style: { fontFamily, fontWeight, fontSize } });

test("os nomes das camadas são os mesmos no painel e na função", () => {
  assert.deepEqual(CAMADAS_FUNCAO, CAMADAS);
});

test("lê cores, fontes, cantos e imagens trocadas da folha do Figma", () => {
  const folha: NoFigma = { name: "Frame", type: "FRAME", children: [
    { name: "Fundo da página", type: "VECTOR", fills: [{ type: "IMAGE", imageRef: "ref-fundo" }, ...solido(1, 0.98, 0.9)] },
    { name: "Logo", type: "RECTANGLE", fills: [{ type: "IMAGE", imageRef: "ref-logo" }] },
    texto("Título", "Bebas Neue", 400, 40, solido(0.1, 0.1, 0.1)),
    { name: "Linha do cabeçalho", type: "VECTOR", fills: solido(0, 0.5, 0) },
    { name: "Categoria: Cervejas", type: "GROUP", children: [
      { name: "Faixa da categoria", type: "VECTOR", fills: solido(0, 0, 0.5) },
      texto("Nome da categoria", "Bebas Neue", 400, 20, solido(1, 1, 1)),
    ] },
    { name: "Cartão", type: "GROUP", children: [
      { name: "Fundo do cartão", type: "RECTANGLE", fills: solido(1, 1, 1), strokes: solido(0.8, 0.8, 0.8), cornerRadius: 16 },
      texto("Nome do produto", "Montserrat", 600, 14),
      texto("Preço", "Montserrat", 800, 18, solido(0.8, 0, 0)),
    ] },
    // Cartão escondido / segundo cartão não mudam o resultado (vale o primeiro visível)
    { name: "Cartão", type: "GROUP", children: [texto("Preço", "Arial", 400, 9, solido(0, 0, 1))] },
    { ...texto("Rodapé", "Comic", 400, 8), visible: false },
  ] };
  const r = extrairTema(folha);
  assert.equal(r.tema.fundo, "#fffae6");
  assert.deepEqual(r.imagens, { fundo: "ref-fundo", logo: "ref-logo" });
  assert.deepEqual(r.tema.titulo, { cor: "#1a1a1a", fonte: "Bebas Neue", peso: 400, tamanho: 40 });
  assert.equal(r.tema.destaque, "#008000");
  assert.deepEqual(r.tema.categoria, { cor: "#ffffff", fonte: "Bebas Neue", peso: 400, tamanho: 20, fundo: "#000080" });
  assert.deepEqual(r.tema.cartao, { fundo: "#ffffff", borda: "#cccccc", raio: 16 });
  assert.deepEqual(r.tema.preco, { cor: "#cc0000", fonte: "Montserrat", peso: 800, tamanho: 18 });
  assert.ok(!("rodape" in r.tema));
  assert.ok(r.faltando.includes("Rodapé") && r.encontradas.includes("Preço"));

  // O painel completa o resto com o padrão
  const tema = normalizarTema(r.tema);
  assert.equal(tema.descricao.fonte, TEMA_PADRAO.descricao.fonte);
  assert.equal(tema.cartao.fotoFundo, TEMA_PADRAO.cartao.fotoFundo);
  assert.deepEqual(linksFontes(tema).sort(), [
    "https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&display=swap",
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@600&display=swap",
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap",
  ]);
});

test("tema inválido não passa: cores, fontes, números e imagens de fora", () => {
  const t = normalizarTema({
    fundo: "red", destaque: "#ABCDEF", logo: "https://evil.example/x.png", fundoImagem: "javascript:alert(1)",
    titulo: { cor: "#123456", fonte: "Inter; } body { display:none", peso: 950, tamanho: 500 },
    cartao: { raio: -4 },
  });
  assert.equal(t.fundo, TEMA_PADRAO.fundo);
  assert.equal(t.destaque, "#abcdef");
  assert.equal(t.logo, null);
  assert.equal(t.fundoImagem, null);
  assert.deepEqual(t.titulo, { cor: "#123456", fonte: TEMA_PADRAO.titulo.fonte, peso: 900, tamanho: 72 });
  assert.equal(t.cartao.raio, 0);
  const ok = normalizarTema({ logo: "https://abc.supabase.co/storage/v1/object/public/produtos/catalogo/1f2e-3a.png" });
  assert.equal(ok.logo, "https://abc.supabase.co/storage/v1/object/public/produtos/catalogo/1f2e-3a.png");
});

test("link do Figma: arquivo, folha e branch", () => {
  assert.deepEqual(lerLinkFigma("https://www.figma.com/design/eC9GXWBGSP7hMPZGTUxeBV/Catalogo?node-id=12-34&t=x"), { arquivo: "eC9GXWBGSP7hMPZGTUxeBV", no: "12:34" });
  assert.deepEqual(lerLinkFigma("https://figma.com/file/eC9GXWBGSP7hMPZGTUxeBV/x"), { arquivo: "eC9GXWBGSP7hMPZGTUxeBV", no: null });
  assert.deepEqual(lerLinkFigma("https://www.figma.com/design/eC9GXWBGSP7hMPZGTUxeBV/branch/BRANCHxxxxxxxxxxxxxxxxx/x")?.arquivo, "BRANCHxxxxxxxxxxxxxxxxx");
  assert.equal(lerLinkFigma("https://figma.com.evil.com/design/eC9GXWBGSP7hMPZGTUxeBV/x"), null);
  assert.equal(lerLinkFigma("não é link"), null);
});

test("folha para o Figma: uma página, camadas com nome, texto escapado e quebra de linha", () => {
  const itens = Array.from({ length: 60 }, (_, i) => ({
    chave: `p${i}`, nome: `Produto <${i}> & cia com nome bem comprido para quebrar`, descricao: "Gelada", foto: null,
    preco: 1000 + i, disponivel: true, atributo: null, variacoes: [], produtos: [],
  }));
  const catalogo: SecaoCatalogo[] = [{ id: "c", nome: "Cervejas", grupos: [{ nome: "Lata", itens }] }];
  const svg = gerarFolhaSvg(catalogo, TEMA_PADRAO, {
    nome: "Adega011", subtitulo: "Catálogo", contato: ["WhatsApp: (11) 9"], rodape: "Rodapé", mostrarPrecos: true,
    mostrarFotos: true, mostrarDescricao: true, imagens: new Map(), logo: null,
  });
  for (const nome of ["Fundo da página", "Título", "Faixa da categoria", "Nome da categoria", "Nome da subcategoria", "Fundo do cartão", "Nome do produto", "Preço", "Rodapé"]) {
    assert.ok(svg.includes(`id="${nome}"`), nome);
  }
  assert.ok(svg.includes("Produto &lt;0&gt; &amp; cia"));
  const cartoes = svg.match(/id="Cartão"/g)!.length;
  assert.ok(cartoes >= 8 && cartoes < 60, `${cartoes} cartões numa folha`);
  assert.ok(svg.includes('width="794" height="1123"'));
  // Sem descrição: some a camada
  const semDescricao = gerarFolhaSvg(catalogo, TEMA_PADRAO, { nome: "A", subtitulo: "", contato: [], rodape: "", mostrarPrecos: false, mostrarFotos: false, mostrarDescricao: false, imagens: new Map(), logo: null });
  assert.ok(!semDescricao.includes('id="Descrição"') && !semDescricao.includes('id="Preço"'));
  assert.deepEqual(quebrarTexto("Cerveja Pilsen Lata 350 ml gelada", 12, 2), ["Cerveja", "Pilsen Lata…"]);
  assert.equal(escaparXml(`"a'<`), "&quot;a&apos;&lt;");
});
