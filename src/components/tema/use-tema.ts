"use client";

import { useSyncExternalStore } from "react";
import { aplicarTema, temaAtual, type Tema } from "@/lib/tema";

function assinar(avisar: () => void) {
  const obs = new MutationObserver(avisar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
  // Outra aba trocou o tema
  const aoGuardar = (e: StorageEvent) => {
    if (e.key === "adega011-tema" && (e.newValue === "claro" || e.newValue === "escuro")) aplicarTema(e.newValue);
  };
  window.addEventListener("storage", aoGuardar);
  return () => {
    obs.disconnect();
    window.removeEventListener("storage", aoGuardar);
  };
}

/** Tema atual (atualiza quando muda) e função para trocar. */
export function useTema(): [Tema, (t: Tema) => void] {
  const tema = useSyncExternalStore(assinar, temaAtual, () => "escuro" as Tema);
  return [tema, aplicarTema];
}
