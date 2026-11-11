"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Carrinho guardado no navegador. Cada linha é "produto + adicionais
 * escolhidos"; preço e nomes vêm sempre do cardápio atual.
 */
export interface LinhaSalva {
  produtoId: string;
  opcoes: string[]; // ids das opções, ordenados
  quantidade: number;
}

interface EstadoCarrinho {
  itens: Record<string, LinhaSalva>;
  aberto: boolean;
  /** Soma `quantidade` à linha do produto com esses adicionais (cria se não existir). */
  adicionar: (produtoId: string, opcoes?: string[], quantidade?: number) => void;
  /** Tira 1 da linha (remove a linha quando chega a 0). */
  remover: (chave: string) => void;
  definir: (chave: string, quantidade: number) => void;
  limpar: () => void;
  setAberto: (v: boolean) => void;
}

export const QTD_MAXIMA = 99;

/** Identificador da linha: mesmo produto com adicionais diferentes = linhas diferentes. */
export function chaveDe(produtoId: string, opcoes: string[] = []): string {
  return `${produtoId}|${[...opcoes].sort().join(",")}`;
}

/** Quantidade total de um produto no carrinho (somando todas as variações). */
export function quantidadeDoProduto(itens: Record<string, LinhaSalva>, produtoId: string): number {
  let total = 0;
  for (const l of Object.values(itens)) if (l.produtoId === produtoId) total += l.quantidade;
  return total;
}

export const useCarrinho = create<EstadoCarrinho>()(
  persist(
    (set) => ({
      itens: {},
      aberto: false,
      adicionar: (produtoId, opcoes = [], quantidade = 1) =>
        set((s) => {
          const ordenadas = [...opcoes].sort();
          const chave = chaveDe(produtoId, ordenadas);
          const atual = s.itens[chave]?.quantidade ?? 0;
          return {
            itens: {
              ...s.itens,
              [chave]: { produtoId, opcoes: ordenadas, quantidade: Math.min(atual + quantidade, QTD_MAXIMA) },
            },
          };
        }),
      remover: (chave) =>
        set((s) => {
          const linha = s.itens[chave];
          if (!linha) return s;
          const itens = { ...s.itens };
          if (linha.quantidade <= 1) delete itens[chave];
          else itens[chave] = { ...linha, quantidade: linha.quantidade - 1 };
          return { itens };
        }),
      definir: (chave, quantidade) =>
        set((s) => {
          const linha = s.itens[chave];
          if (!linha) return s;
          const itens = { ...s.itens };
          if (quantidade <= 0) delete itens[chave];
          else itens[chave] = { ...linha, quantidade: Math.min(quantidade, QTD_MAXIMA) };
          return { itens };
        }),
      limpar: () => set({ itens: {} }),
      setAberto: (aberto) => set({ aberto }),
    }),
    {
      name: "adega011:carrinho",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ itens: s.itens }),
      // v1 guardava { produtoId: quantidade }
      migrate: (antigo, versao) => {
        const estado = (antigo ?? {}) as { itens?: Record<string, unknown> };
        if (versao < 2 && estado.itens) {
          const itens: Record<string, LinhaSalva> = {};
          for (const [id, q] of Object.entries(estado.itens)) {
            if (typeof q === "number" && q > 0) itens[chaveDe(id)] = { produtoId: id, opcoes: [], quantidade: q };
          }
          return { itens };
        }
        return estado as { itens: Record<string, LinhaSalva> };
      },
      // Reidratado manualmente após montar, para não divergir do HTML do servidor.
      skipHydration: true,
    },
  ),
);
