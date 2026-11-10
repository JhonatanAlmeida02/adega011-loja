"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Carrinho guardado no navegador. Guarda só id -> quantidade;
 * preço e nome vêm sempre do cardápio atual (evita preço desatualizado).
 */
interface EstadoCarrinho {
  itens: Record<string, number>;
  aberto: boolean;
  adicionar: (id: string) => void;
  remover: (id: string) => void;
  definir: (id: string, quantidade: number) => void;
  limpar: () => void;
  setAberto: (v: boolean) => void;
}

export const QTD_MAXIMA = 99;

export const useCarrinho = create<EstadoCarrinho>()(
  persist(
    (set) => ({
      itens: {},
      aberto: false,
      adicionar: (id) =>
        set((s) => ({ itens: { ...s.itens, [id]: Math.min((s.itens[id] ?? 0) + 1, QTD_MAXIMA) } })),
      remover: (id) =>
        set((s) => {
          const q = (s.itens[id] ?? 0) - 1;
          const itens = { ...s.itens };
          if (q <= 0) delete itens[id];
          else itens[id] = q;
          return { itens };
        }),
      definir: (id, quantidade) =>
        set((s) => {
          const itens = { ...s.itens };
          if (quantidade <= 0) delete itens[id];
          else itens[id] = Math.min(quantidade, QTD_MAXIMA);
          return { itens };
        }),
      limpar: () => set({ itens: {} }),
      setAberto: (aberto) => set({ aberto }),
    }),
    {
      name: "adega011:carrinho",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ itens: s.itens }),
      // Reidratado manualmente após montar, para não divergir do HTML do servidor.
      skipHydration: true,
    },
  ),
);
