"use client";

import { useEffect } from "react";
import { useCarrinho } from "@/lib/carrinho";

/** Carrega o carrinho salvo no navegador depois de montar a página. */
export function IniciarCarrinho() {
  useEffect(() => {
    void useCarrinho.persist.rehydrate();
  }, []);
  return null;
}
