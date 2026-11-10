"use client";

import { useEffect, useState } from "react";
import { statusDaLoja, type StatusLoja } from "@/lib/horario";
import type { Configuracoes } from "@/lib/tipos";

/**
 * Status aberto/fechado calculado no navegador (fuso de São Paulo) e
 * atualizado a cada 30 s. Retorna null até montar, para não divergir do HTML
 * pré-renderizado.
 */
export function useStatusLoja(config: Pick<Configuracoes, "horarios" | "status_manual">): StatusLoja | null {
  const [status, setStatus] = useState<StatusLoja | null>(null);
  useEffect(() => {
    const atualizar = () => setStatus(statusDaLoja(config));
    atualizar();
    const t = setInterval(atualizar, 30_000);
    return () => clearInterval(t);
  }, [config]);
  return status;
}
