// Lê o design do catálogo de uma folha do Figma (resposta da API REST do Figma).
// Procura as camadas pelo nome (os mesmos do modelo exportado pelo painel) e
// devolve cores, fontes e as imagens de logo/fundo trocadas.
// Sem APIs do Deno: também é testado no Node (tests/unit).

export const CAMADAS = {
  fundo: "Fundo da página",
  logo: "Logo",
  titulo: "Título",
  subtitulo: "Subtítulo",
  contato: "Contato",
  destaque: "Linha do cabeçalho",
  categoriaFundo: "Faixa da categoria",
  categoria: "Nome da categoria",
  subcategoria: "Nome da subcategoria",
  subcategoriaMarca: "Marca da subcategoria",
  cartao: "Cartão",
  cartaoFundo: "Fundo do cartão",
  fotoFundo: "Fundo da foto",
  foto: "Foto",
  nome: "Nome do produto",
  descricao: "Descrição",
  preco: "Preço",
  variacoes: "Variações",
  rodape: "Rodapé",
} as const;

type Cor = { r: number; g: number; b: number; a?: number };
type Pintura = { type: string; visible?: boolean; color?: Cor; imageRef?: string };
export interface NoFigma {
  name?: string;
  type?: string;
  visible?: boolean;
  fills?: Pintura[];
  strokes?: Pintura[];
  cornerRadius?: number;
  style?: { fontFamily?: string; fontWeight?: number; fontSize?: number };
  children?: NoFigma[];
}

export const normalizarNome = (nome: string) =>
  nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const hex = (c: Cor) =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

const visiveis = (lista?: Pintura[]) => (lista ?? []).filter((p) => p.visible !== false);
const corSolida = (lista?: Pintura[]) => {
  const p = visiveis(lista).find((x) => x.type === "SOLID" && x.color);
  return p?.color ? hex(p.color) : undefined;
};
const imagem = (lista?: Pintura[]) => visiveis(lista).find((x) => x.type === "IMAGE" && x.imageRef)?.imageRef;

/** Primeira camada (visível) com cada nome, na ordem da árvore. */
export function indexarCamadas(raiz: NoFigma): Map<string, NoFigma> {
  const mapa = new Map<string, NoFigma>();
  const pilha: NoFigma[] = [raiz];
  while (pilha.length) {
    const no = pilha.shift()!;
    if (no.visible === false) continue;
    if (no.name) {
      const chave = normalizarNome(no.name);
      if (!mapa.has(chave)) mapa.set(chave, no);
    }
    if (no.children) pilha.unshift(...no.children);
  }
  return mapa;
}

function estiloTexto(no: NoFigma | undefined) {
  if (!no || no.type !== "TEXT") return undefined;
  const e: Record<string, unknown> = {};
  const cor = corSolida(no.fills);
  if (cor) e.cor = cor;
  if (no.style?.fontFamily) e.fonte = no.style.fontFamily;
  if (no.style?.fontWeight) e.peso = no.style.fontWeight;
  if (no.style?.fontSize) e.tamanho = no.style.fontSize;
  return e;
}

export interface Extraido {
  /** Tema parcial (o painel completa o que faltar com o padrão e valida). */
  tema: Record<string, unknown>;
  /** imageRef das imagens trocadas no Figma. */
  imagens: { logo?: string; fundo?: string };
  encontradas: string[];
  faltando: string[];
}

export function extrairTema(raiz: NoFigma): Extraido {
  const camadas = indexarCamadas(raiz);
  const pegar = (nome: string) => camadas.get(normalizarNome(nome));
  const tema: Record<string, unknown> = {};
  const imagens: Extraido["imagens"] = {};

  const fundo = pegar(CAMADAS.fundo);
  if (fundo) {
    const c = corSolida(fundo.fills);
    if (c) tema.fundo = c;
    const img = imagem(fundo.fills);
    if (img) imagens.fundo = img;
  }
  const logo = imagem(pegar(CAMADAS.logo)?.fills);
  if (logo) imagens.logo = logo;
  const destaque = corSolida(pegar(CAMADAS.destaque)?.fills);
  if (destaque) tema.destaque = destaque;

  const textos: [string, string][] = [
    ["titulo", CAMADAS.titulo], ["subtitulo", CAMADAS.subtitulo], ["contato", CAMADAS.contato],
    ["categoria", CAMADAS.categoria], ["subcategoria", CAMADAS.subcategoria], ["nome", CAMADAS.nome],
    ["descricao", CAMADAS.descricao], ["preco", CAMADAS.preco], ["variacoes", CAMADAS.variacoes], ["rodape", CAMADAS.rodape],
  ];
  for (const [chave, nome] of textos) {
    const e = estiloTexto(pegar(nome));
    if (e) tema[chave] = e;
  }

  const faixa = corSolida(pegar(CAMADAS.categoriaFundo)?.fills);
  if (faixa) tema.categoria = { ...(tema.categoria as object ?? {}), fundo: faixa };
  const marca = corSolida(pegar(CAMADAS.subcategoriaMarca)?.fills);
  if (marca) tema.subcategoria = { ...(tema.subcategoria as object ?? {}), marca };

  const cartao: Record<string, unknown> = {};
  const fundoCartao = pegar(CAMADAS.cartaoFundo);
  if (fundoCartao) {
    const c = corSolida(fundoCartao.fills);
    if (c) cartao.fundo = c;
    const b = corSolida(fundoCartao.strokes);
    if (b) cartao.borda = b;
    if (typeof fundoCartao.cornerRadius === "number") cartao.raio = fundoCartao.cornerRadius;
  }
  const fotoFundo = corSolida(pegar(CAMADAS.fotoFundo)?.fills);
  if (fotoFundo) cartao.fotoFundo = fotoFundo;
  if (Object.keys(cartao).length) tema.cartao = cartao;

  const todas = Object.values(CAMADAS);
  return {
    tema,
    imagens,
    encontradas: todas.filter((n) => pegar(n)),
    faltando: todas.filter((n) => !pegar(n)),
  };
}

/** Chave do arquivo e id da folha a partir do link do Figma. */
export function lerLinkFigma(link: string): { arquivo: string; no: string | null } | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:design|file)\/([A-Za-z0-9]{22,128})(?:\/branch\/([A-Za-z0-9]{22,128}))?/);
  if (!m) return null;
  const no = url.searchParams.get("node-id");
  return { arquivo: m[2] ?? m[1], no: no && /^\d+[-:]\d+$/.test(no) ? no.replace("-", ":") : null };
}
