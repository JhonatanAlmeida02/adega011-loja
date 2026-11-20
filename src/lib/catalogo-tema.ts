import type { CSSProperties } from "react";

/**
 * Design do catálogo exportado: cores, fontes e alguns tamanhos.
 * O padrão é o da marca; o "do Figma" vem de uma folha editada no Figma e
 * reimportada (Edge Function catalogo-figma), e vale para todas as páginas.
 */

export interface EstiloTexto { cor: string; fonte: string; peso: number; tamanho: number }

/** Elemento adicionado no Figma (logo grande, marca d'água…): imagem na mesma posição em todas as páginas, em % da folha A4. */
export interface Decoracao { imagem: string; x: number; y: number; largura: number; altura: number }

export interface TemaCatalogo {
  fundo: string;
  /** Imagem de fundo da página (Storage). */
  fundoImagem?: string | null;
  /** Logo trocado no Figma (Storage). Sem ele, usa o selo da marca. */
  logo?: string | null;
  destaque: string;
  titulo: EstiloTexto;
  subtitulo: EstiloTexto;
  contato: EstiloTexto;
  categoria: EstiloTexto & { fundo: string };
  subcategoria: EstiloTexto & { marca: string };
  cartao: { fundo: string; borda: string; raio: number; fotoFundo: string };
  nome: EstiloTexto;
  descricao: EstiloTexto;
  preco: EstiloTexto;
  variacoes: EstiloTexto;
  rodape: EstiloTexto;
  decoracoes: Decoracao[];
}

export const TEMA_PADRAO: TemaCatalogo = {
  fundo: "#ffffff",
  fundoImagem: null,
  logo: null,
  destaque: "#ff5c8a",
  titulo: { cor: "#171717", fonte: "Anton", peso: 400, tamanho: 34 },
  subtitulo: { cor: "#525252", fonte: "DM Sans", peso: 400, tamanho: 14 },
  contato: { cor: "#404040", fonte: "DM Sans", peso: 400, tamanho: 11 },
  categoria: { cor: "#ffffff", fonte: "Anton", peso: 400, tamanho: 17, fundo: "#171717" },
  subcategoria: { cor: "#404040", fonte: "DM Sans", peso: 700, tamanho: 13, marca: "#ff5c8a" },
  cartao: { fundo: "#ffffff", borda: "#e5e5e5", raio: 8, fotoFundo: "#fafafa" },
  nome: { cor: "#171717", fonte: "DM Sans", peso: 700, tamanho: 13 },
  descricao: { cor: "#737373", fonte: "DM Sans", peso: 400, tamanho: 11 },
  preco: { cor: "#e0406f", fonte: "DM Sans", peso: 900, tamanho: 16 },
  variacoes: { cor: "#404040", fonte: "DM Sans", peso: 400, tamanho: 11 },
  rodape: { cor: "#737373", fonte: "DM Sans", peso: 400, tamanho: 11 },
  decoracoes: [],
};

const TEXTOS = ["titulo", "subtitulo", "contato", "categoria", "subcategoria", "nome", "descricao", "preco", "variacoes", "rodape"] as const;

const HEX = /^#[0-9a-f]{6}$/;
const FONTE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
/** Imagens só do Storage do projeto, na pasta do catálogo. */
const IMAGEM = /^https:\/\/[a-z0-9.-]+(:\d+)?\/storage\/v1\/object\/public\/produtos\/catalogo\/[a-z0-9-]+\.(png|jpe?g|webp)$/;
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/storage\/v1\/object\/public\/produtos\/catalogo\/[a-z0-9-]+\.(png|jpe?g|webp)$/;

const cor = (v: unknown, padrao: string) => (typeof v === "string" && HEX.test(v.toLowerCase()) ? v.toLowerCase() : padrao);
const numero = (v: unknown, min: number, max: number, padrao: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : padrao;
const imagem = (v: unknown) => (typeof v === "string" && (IMAGEM.test(v) || LOCAL.test(v)) ? v : null);

function texto(v: unknown, padrao: EstiloTexto): EstiloTexto {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    cor: cor(o.cor, padrao.cor),
    fonte: typeof o.fonte === "string" && FONTE.test(o.fonte) ? o.fonte : padrao.fonte,
    peso: Math.round(numero(o.peso, 100, 900, padrao.peso) / 100) * 100,
    tamanho: numero(o.tamanho, 6, 72, padrao.tamanho),
  };
}

const porcento = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null;

function decoracoes(v: unknown): Decoracao[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 8).flatMap((d) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    const img = imagem(o.imagem);
    const x = porcento(o.x, -100, 200), y = porcento(o.y, -100, 200);
    const largura = porcento(o.largura, 0.1, 300), altura = porcento(o.altura, 0.1, 300);
    return img && x !== null && y !== null && largura !== null && altura !== null ? [{ imagem: img, x, y, largura, altura }] : [];
  });
}

/** Aceita qualquer coisa e devolve um tema válido (o que faltar vem do padrão). */
export function normalizarTema(entrada: unknown): TemaCatalogo {
  const o = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const p = TEMA_PADRAO;
  const cat = (o.categoria ?? {}) as Record<string, unknown>;
  const sub = (o.subcategoria ?? {}) as Record<string, unknown>;
  const car = (o.cartao ?? {}) as Record<string, unknown>;
  const tema = {
    fundo: cor(o.fundo, p.fundo),
    fundoImagem: imagem(o.fundoImagem),
    logo: imagem(o.logo),
    destaque: cor(o.destaque, p.destaque),
    cartao: {
      fundo: cor(car.fundo, p.cartao.fundo), borda: cor(car.borda, p.cartao.borda),
      raio: numero(car.raio, 0, 40, p.cartao.raio), fotoFundo: cor(car.fotoFundo, p.cartao.fotoFundo),
    },
  } as TemaCatalogo;
  for (const k of TEXTOS) (tema as unknown as Record<string, EstiloTexto>)[k] = texto(o[k], p[k]);
  tema.decoracoes = decoracoes(o.decoracoes);
  tema.categoria = { ...tema.categoria, fundo: cor(cat.fundo, p.categoria.fundo) };
  tema.subcategoria = { ...tema.subcategoria, marca: cor(sub.marca, p.subcategoria.marca) };
  return tema;
}

/** Fontes já carregadas pelo site (não precisam do Google Fonts). */
const FONTES_DO_SITE: Record<string, string> = {
  anton: "var(--font-titulo)",
  "dm sans": "var(--font-sans)",
  "space mono": "var(--font-mono)",
};
const SEM_DOWNLOAD = new Set(["arial", "helvetica", "georgia", "times new roman", "verdana", "courier new", "impact"]);

export function familiaCss(fonte: string): string {
  const site = FONTES_DO_SITE[fonte.toLowerCase()];
  return site ? `${site}, sans-serif` : `"${fonte}", Arial, sans-serif`;
}

/** Estilo inline de um texto do tema. */
export function estiloTexto(e: EstiloTexto): CSSProperties {
  return { color: e.cor, fontFamily: familiaCss(e.fonte), fontWeight: e.peso, fontSize: `${e.tamanho}px` };
}

/** Links do Google Fonts para as fontes do tema que o site não carrega. */
export function linksFontes(tema: TemaCatalogo): string[] {
  const pesos = new Map<string, Set<number>>();
  for (const k of TEXTOS) {
    const e = tema[k];
    const f = e.fonte.toLowerCase();
    if (FONTES_DO_SITE[f] || SEM_DOWNLOAD.has(f)) continue;
    pesos.set(e.fonte, (pesos.get(e.fonte) ?? new Set()).add(e.peso));
  }
  // Um link por peso: se a fonte não tiver aquele peso, só aquele link falha
  return [...pesos].flatMap(([fonte, ps]) =>
    [...ps].map((p) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fonte).replace(/%20/g, "+")}:wght@${p}&display=swap`));
}

/** Nomes das camadas do modelo (o SVG exportado usa estes nomes; a reimportação procura por eles). */
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
