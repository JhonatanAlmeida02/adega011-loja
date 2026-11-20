import type { Secao } from "./catalogo-secoes";
import { produtoDisponivel, type Produto } from "./tipos";

/** Um item do catálogo: produto simples/kit, ou uma família com as variações. */
export interface ItemCatalogo {
  chave: string;
  nome: string;
  descricao: string;
  foto: string | null;
  /** Menor preço (das variações disponíveis, se houver). */
  preco: number;
  disponivel: boolean;
  atributo: string | null;
  variacoes: { id: string; nome: string; preco: number; disponivel: boolean }[];
  /** SKUs que compõem o item (para a planilha). */
  produtos: Produto[];
}

export interface GrupoCatalogo { nome: string | null; itens: ItemCatalogo[] }
export interface SecaoCatalogo { id: string; nome: string; grupos: GrupoCatalogo[] }

export interface OpcoesCatalogo {
  /** Slugs das seções escolhidas; null = todas. */
  secoes: Set<string> | null;
  /** Deixa de fora o que não pode ser vendido agora (esgotado, pausado). */
  soDisponiveis: boolean;
  /** Cada variação (sabor, cor) no seu próprio cartão, como na loja. Padrão: sim. */
  separarVariacoes?: boolean;
  /** Ordem das seções (slugs) só para o catálogo; as que faltarem vão no fim, na ordem da loja. */
  ordem?: string[] | null;
}

/** Ordena as seções pela ordem escolhida para o catálogo (as novas ficam no fim). */
export function ordenarSecoes<T extends { id: string }>(secoes: T[], ordem?: string[] | null): T[] {
  if (!ordem?.length) return secoes;
  const posicao = new Map(ordem.map((id, i) => [id, i]));
  return secoes
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (posicao.get(a.s.id) ?? ordem.length + a.i) - (posicao.get(b.s.id) ?? ordem.length + b.i))
    .map(({ s }) => s);
}

/** Cada SKU num cartão (variação com o nome completo, ex.: "BALA HALLS 28G · CEREJA"). */
function itensSeparados(produtos: Produto[]): ItemCatalogo[] {
  const fotoDaFamilia = new Map<string, string>();
  for (const p of produtos) if (p.familia_id && p.foto_url && !fotoDaFamilia.has(p.familia_id)) fotoDaFamilia.set(p.familia_id, p.foto_url);
  return produtos.filter((p) => !p.preco_pendente).map((p) => {
    // Sem o nome da família (ex.: só "Melancia"), mostra "Baly 2L · Melancia"
    const nome = p.familia_id && p.familia_nome && !p.nome.toLowerCase().includes(p.familia_nome.toLowerCase())
      ? `${p.familia_nome} · ${p.variacao_nome || p.nome}` : p.nome;
    return {
      chave: p.id, nome, descricao: p.descricao, foto: p.foto_url ?? (p.familia_id ? fotoDaFamilia.get(p.familia_id) ?? null : null),
      preco: p.preco, disponivel: produtoDisponivel(p), atributo: null, variacoes: [], produtos: [p],
    };
  });
}

/** Junta as variações de cada família num item só ("Rothmans: Azul, Vermelho"). */
function itensDoGrupo(produtos: Produto[]): ItemCatalogo[] {
  const itens: ItemCatalogo[] = [];
  const familias = new Map<string, ItemCatalogo>();
  for (const p of produtos) {
    if (p.preco_pendente) continue;
    if (p.familia_id) {
      let item = familias.get(p.familia_id);
      if (!item) {
        item = {
          chave: `familia-${p.familia_id}`, nome: p.familia_nome || p.nome, descricao: p.descricao, foto: p.foto_url,
          preco: p.preco, disponivel: false, atributo: p.variacao_atributo ?? null, variacoes: [], produtos: [],
        };
        familias.set(p.familia_id, item);
        itens.push(item);
      }
      const disponivel = produtoDisponivel(p);
      item.variacoes.push({ id: p.id, nome: p.variacao_nome || p.nome, preco: p.preco, disponivel });
      item.produtos.push(p);
      item.foto ??= p.foto_url;
      item.descricao ||= p.descricao;
      continue;
    }
    itens.push({
      chave: p.id, nome: p.nome, descricao: p.descricao, foto: p.foto_url, preco: p.preco,
      disponivel: produtoDisponivel(p), atributo: null, variacoes: [], produtos: [p],
    });
  }
  for (const item of familias.values()) {
    const vendaveis = item.variacoes.filter((v) => v.disponivel);
    item.disponivel = vendaveis.length > 0;
    item.preco = Math.min(...(vendaveis.length ? vendaveis : item.variacoes).map((v) => v.preco));
  }
  return itens;
}

/** Catálogo a partir das seções da vitrine (mesmas regras de visibilidade do site). */
export function montarCatalogo(secoes: Secao[], opcoes: OpcoesCatalogo): SecaoCatalogo[] {
  const separar = opcoes.separarVariacoes ?? true;
  return ordenarSecoes(secoes, opcoes.ordem)
    .filter((s) => !opcoes.secoes || opcoes.secoes.has(s.id))
    .map((s) => ({
      id: s.id,
      nome: s.nome,
      grupos: s.grupos
        .map((g) => {
          let itens = separar ? itensSeparados(g.produtos) : itensDoGrupo(g.produtos);
          if (opcoes.soDisponiveis) {
            itens = itens
              .filter((i) => i.disponivel)
              .map((i) => (i.variacoes.length ? { ...i, variacoes: i.variacoes.filter((v) => v.disponivel) } : i));
          }
          return { nome: g.nome, itens };
        })
        .filter((g) => g.itens.length > 0),
    }))
    .filter((s) => s.grupos.length > 0);
}

/** Variações com preços iguais viram "Sabores: A, B" com um preço só. */
export function precosIguais(item: ItemCatalogo): boolean {
  return item.variacoes.every((v) => v.preco === item.variacoes[0]?.preco);
}

export function contarItens(catalogo: SecaoCatalogo[]): number {
  return catalogo.reduce((n, s) => n + s.grupos.reduce((m, g) => m + g.itens.length, 0), 0);
}

const precoPlanilha = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

function celula(valor: string): string {
  const texto = valor.replace(/\r?\n/g, " ").trim();
  // Evita que o Excel trate o texto como fórmula
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return /[";]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * Planilha CSV para Excel em português: separador ";", vírgula decimal e BOM
 * (para os acentos abrirem certos). Uma linha por SKU.
 */
export function planilhaCatalogo(catalogo: SecaoCatalogo[], skus: Map<string, string>): string {
  const linhas = [["Categoria", "Subcategoria", "Produto", "Variação", "SKU", "Preço (R$)", "Disponível", "Descrição"]];
  for (const s of catalogo) {
    for (const g of s.grupos) {
      for (const item of g.itens) {
        const variacoes = new Map(item.variacoes.map((v) => [v.id, v]));
        for (const p of item.produtos) {
          const v = variacoes.get(p.id);
          if (item.variacoes.length && !v) continue; // variação filtrada (esgotada)
          linhas.push([
            s.nome, g.nome ?? "", item.variacoes.length ? item.nome : p.familia_nome || item.nome, v?.nome ?? p.variacao_nome ?? "", skus.get(p.id) ?? "",
            precoPlanilha(v?.preco ?? item.preco), (v ? v.disponivel : item.disponivel) ? "Sim" : "Não", item.descricao ?? "",
          ]);
        }
      }
    }
  }
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
