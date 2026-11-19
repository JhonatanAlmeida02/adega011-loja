import type { ItemCatalogo, SecaoCatalogo } from "./catalogo-exportar";
import { precosIguais } from "./catalogo-exportar";
import { CAMADAS, type EstiloTexto, type TemaCatalogo } from "./catalogo-tema";
import { formatarPreco } from "./utils";

/**
 * Modelo para o Figma: UMA folha A4 do catálogo em SVG, com as camadas
 * nomeadas (o Figma usa o id como nome da camada). O cliente edita cores,
 * fontes, logo e fundo dessa folha; a reimportação aplica o visual em todas.
 */

export const LARGURA = 794; // A4 a 96 dpi
export const ALTURA = 1123;
const MARGEM = 38;
const COLUNAS = 4;
const VAO = 8;

export interface OpcoesSvg {
  nome: string;
  subtitulo: string;
  contato: string[];
  rodape: string;
  mostrarPrecos: boolean;
  mostrarFotos: boolean;
  mostrarDescricao: boolean;
  /** Imagens já embutidas (data:...) por URL original. */
  imagens: Map<string, string>;
  /** Logo embutido (data:...). */
  logo: string | null;
}

export function escaparXml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Quebra o texto em até `linhas` linhas de ~`largura` caracteres (com reticências no fim). */
export function quebrarTexto(texto: string, largura: number, linhas: number): string[] {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  const saida: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (tentativa.length <= largura) { atual = tentativa; continue; }
    if (atual) saida.push(atual);
    atual = p.length > largura ? `${p.slice(0, largura - 1)}…` : p;
    if (saida.length === linhas) break;
  }
  if (atual && saida.length < linhas) saida.push(atual);
  if (saida.length === linhas && saida.join(" ").length < texto.trim().length) {
    const ultima = saida[linhas - 1];
    saida[linhas - 1] = ultima.length >= largura ? `${ultima.slice(0, largura - 1)}…` : `${ultima}…`;
  }
  return saida.slice(0, linhas);
}

const id = (nome: string) => escaparXml(nome);

function textoSvg(nome: string, x: number, y: number, conteudo: string, e: EstiloTexto, extra = ""): string {
  return `<text id="${id(nome)}" x="${x}" y="${y}" font-family="${escaparXml(e.fonte)}" font-weight="${e.peso}" font-size="${e.tamanho}" fill="${e.cor}"${extra}>${escaparXml(conteudo)}</text>`;
}

/** Cartão de um produto; o fundo é desenhado depois, com a altura da linha (cartões iguais). */
function cartaoSvg(item: ItemCatalogo, x: number, y: number, largura: number, tema: TemaCatalogo, o: OpcoesSvg): { svg: (altura: number) => string; altura: number } {
  const partes: string[] = [];
  let cy = y + 8;
  if (o.mostrarFotos) {
    const alturaFoto = Math.round((largura - 16) * 0.75);
    partes.push(`<rect id="${id(CAMADAS.fotoFundo)}" x="${x + 8}" y="${cy}" width="${largura - 16}" height="${alturaFoto}" rx="6" fill="${tema.cartao.fotoFundo}"/>`);
    const foto = item.foto ? o.imagens.get(item.foto) : null;
    if (foto) partes.push(`<image id="${id(CAMADAS.foto)}" x="${x + 8}" y="${cy}" width="${largura - 16}" height="${alturaFoto}" preserveAspectRatio="xMidYMid meet" href="${foto}"/>`);
    cy += alturaFoto + 6;
  }
  const caracteres = Math.max(10, Math.floor((largura - 16) / (tema.nome.tamanho * 0.55)));
  for (const linha of quebrarTexto(item.nome, caracteres, 2)) {
    cy += tema.nome.tamanho + 2;
    partes.push(textoSvg(CAMADAS.nome, x + 8, cy, linha, tema.nome));
  }
  if (o.mostrarDescricao && item.descricao) {
    const [linha] = quebrarTexto(item.descricao, Math.floor((largura - 16) / (tema.descricao.tamanho * 0.5)), 1);
    cy += tema.descricao.tamanho + 3;
    partes.push(textoSvg(CAMADAS.descricao, x + 8, cy, linha, tema.descricao));
  }
  if (item.variacoes.length) {
    const texto = precosIguais(item) || !o.mostrarPrecos
      ? `${item.atributo || "Opções"}: ${item.variacoes.map((v) => v.nome).join(", ")}`
      : item.variacoes.map((v) => `${v.nome} ${formatarPreco(v.preco)}`).join(" · ");
    const [linha] = quebrarTexto(texto, Math.floor((largura - 16) / (tema.variacoes.tamanho * 0.5)), 1);
    cy += tema.variacoes.tamanho + 3;
    partes.push(textoSvg(CAMADAS.variacoes, x + 8, cy, linha, tema.variacoes));
  }
  if (o.mostrarPrecos && (precosIguais(item) || !item.variacoes.length)) {
    cy += tema.preco.tamanho + 6;
    partes.push(textoSvg(CAMADAS.preco, x + 8, cy, formatarPreco(item.preco), tema.preco));
  }
  const fundo = (altura: number) => `<rect id="${id(CAMADAS.cartaoFundo)}" x="${x}" y="${y}" width="${largura}" height="${altura}" rx="${tema.cartao.raio}" fill="${tema.cartao.fundo}" stroke="${tema.cartao.borda}"/>`;
  return { svg: (altura) => `<g id="${id(CAMADAS.cartao)}">${fundo(altura)}${partes.join("")}</g>`, altura: cy - y + 10 };
}

/** Gera a primeira folha do catálogo (o que couber numa página A4). */
export function gerarFolhaSvg(catalogo: SecaoCatalogo[], tema: TemaCatalogo, o: OpcoesSvg): string {
  const largura = LARGURA - MARGEM * 2;
  const larguraCartao = (largura - VAO * (COLUNAS - 1)) / COLUNAS;
  const limite = ALTURA - MARGEM - 40; // espaço do rodapé
  const corpo: string[] = [];

  // Fundo e cabeçalho
  corpo.push(`<rect id="${id(CAMADAS.fundo)}" x="0" y="0" width="${LARGURA}" height="${ALTURA}" fill="${tema.fundo}"/>`);
  if (o.logo) corpo.push(`<image id="${id(CAMADAS.logo)}" x="${MARGEM}" y="${MARGEM}" width="64" height="64" preserveAspectRatio="xMidYMid meet" href="${o.logo}"/>`);
  const xTitulo = MARGEM + (o.logo ? 78 : 0);
  corpo.push(textoSvg(CAMADAS.titulo, xTitulo, MARGEM + tema.titulo.tamanho, o.nome.toUpperCase(), tema.titulo));
  if (o.subtitulo) corpo.push(textoSvg(CAMADAS.subtitulo, xTitulo, MARGEM + tema.titulo.tamanho + tema.subtitulo.tamanho + 8, o.subtitulo, tema.subtitulo));
  o.contato.slice(0, 3).forEach((linha, i) => {
    corpo.push(textoSvg(CAMADAS.contato, LARGURA - MARGEM, MARGEM + 14 + i * (tema.contato.tamanho + 6), linha, tema.contato, ' text-anchor="end"'));
  });
  let y = MARGEM + 80;
  corpo.push(`<rect id="${id(CAMADAS.destaque)}" x="${MARGEM}" y="${y}" width="${largura}" height="4" fill="${tema.destaque}"/>`);
  y += 20;

  // Seções: o que couber na folha. Títulos ficam pendentes até entrar a 1ª linha de
  // produtos embaixo deles (não sobra título sozinho no fim da folha).
  let cheio = false;
  for (const s of catalogo) {
    if (cheio) break;
    const alturaFaixa = tema.categoria.tamanho + 14;
    const pendentes: string[] = [`<g id="${id(`Categoria: ${s.nome}`)}"><rect id="${id(CAMADAS.categoriaFundo)}" x="${MARGEM}" y="${y}" width="${largura}" height="${alturaFaixa}" rx="6" fill="${tema.categoria.fundo}"/>${
      textoSvg(CAMADAS.categoria, MARGEM + 12, y + alturaFaixa / 2 + tema.categoria.tamanho * 0.36, s.nome.toUpperCase(), tema.categoria)}</g>`];
    let yPendente = y + alturaFaixa + 8;
    for (const g of s.grupos) {
      if (cheio) break;
      if (g.nome) {
        pendentes.push(`<rect id="${id(CAMADAS.subcategoriaMarca)}" x="${MARGEM}" y="${yPendente}" width="4" height="${tema.subcategoria.tamanho + 4}" fill="${tema.subcategoria.marca}"/>`);
        pendentes.push(textoSvg(CAMADAS.subcategoria, MARGEM + 10, yPendente + tema.subcategoria.tamanho, g.nome.toUpperCase(), tema.subcategoria));
        yPendente += tema.subcategoria.tamanho + 12;
      }
      for (let i = 0; i < g.itens.length; i += COLUNAS) {
        const linha = g.itens.slice(i, i + COLUNAS).map((item, c) => cartaoSvg(item, MARGEM + c * (larguraCartao + VAO), yPendente, larguraCartao, tema, o));
        const altura = Math.max(...linha.map((l) => l.altura));
        if (yPendente + altura > limite) { cheio = true; break; }
        corpo.push(...pendentes.splice(0), ...linha.map((l) => l.svg(altura)));
        yPendente += altura + VAO;
        y = yPendente;
      }
      yPendente += 6;
      if (!pendentes.length) y = yPendente;
    }
  }

  corpo.push(textoSvg(CAMADAS.rodape, LARGURA / 2, ALTURA - MARGEM, o.rodape, tema.rodape, ' text-anchor="middle"'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${LARGURA}" height="${ALTURA}" viewBox="0 0 ${LARGURA} ${ALTURA}">\n<title>Catálogo ${escaparXml(o.nome)} — modelo para o Figma</title>\n${corpo.join("\n")}\n</svg>\n`;
}
