"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CONFIG_EXEMPLO } from "@/lib/dados-exemplo";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Configuracoes } from "@/lib/tipos";
import { salvar } from "./dados";

/** Lê e salva a linha única de configurações da loja. */
export function useConfiguracoes() {
  const [config, setConfig] = useState<Configuracoes | null>(null);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador()
      .from("configuracoes")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) toast.error(`Erro ao carregar: ${error.message}`);
        setConfig({ ...CONFIG_EXEMPLO, ...(data ?? {}) });
      });
    return () => {
      ativo = false;
    };
  }, []);

  const gravar = async (campos: Partial<Configuracoes>, mensagem = "Configurações salvas") => {
    const ok = await salvar(supabaseNavegador().from("configuracoes").update(campos).eq("id", 1), mensagem);
    if (ok) setConfig((c) => (c ? { ...c, ...campos } : c));
    return ok;
  };

  return { config, gravar };
}
