"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";

export type EstadoSessao =
  | { estado: "carregando" }
  | { estado: "sem-supabase" }
  | { estado: "anonimo" }
  | { estado: "negado"; email: string }
  | { estado: "ok"; email: string; papel: Papel; nome: string };

/** Papel na equipe: admin vê tudo; operador só Pedidos e PDV (o banco garante). */
export type Papel = "admin" | "operador";

/** Confere se há usuário logado e se ele faz parte da equipe (tabela admins), com o papel. */
export function useSessaoAdmin(): EstadoSessao {
  const [sessao, setSessao] = useState<EstadoSessao>(
    supabaseConfigurado ? { estado: "carregando" } : { estado: "sem-supabase" },
  );

  useEffect(() => {
    if (!supabaseConfigurado) return;
    const sb = supabaseNavegador();
    let ativo = true;

    const verificar = async () => {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!ativo) return;
      if (!user) return setSessao({ estado: "anonimo" });
      const { data } = await sb.from("admins").select("papel, nome").eq("user_id", user.id).maybeSingle<{ papel: Papel; nome: string }>();
      if (!ativo) return;
      setSessao(
        data
          ? { estado: "ok", email: user.email ?? "", papel: data.papel === "operador" ? "operador" : "admin", nome: data.nome ?? "" }
          : { estado: "negado", email: user.email ?? "" },
      );
    };

    void verificar();
    const { data } = sb.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT") setSessao({ estado: "anonimo" });
    });
    return () => {
      ativo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return sessao;
}

/** Papel de quem está no painel (o Painel fornece; o padrão é o mais restrito). */
export const PapelPainel = createContext<Papel>("operador");
export const usePapel = () => useContext(PapelPainel);

/** Telas que o operador pode abrir (o resto é só do administrador). */
export const TELAS_OPERADOR = ["/admin", "/admin/pdv"];

/** O papel pode abrir esta tela? (/admin é só a de Pedidos; as outras valem com sub-rotas) */
export function podeAbrir(papel: Papel, caminho: string): boolean {
  if (papel === "admin") return true;
  return TELAS_OPERADOR.some((t) => (t === "/admin" ? caminho === "/admin" || caminho === "/admin/" : caminho === t || caminho.startsWith(`${t}/`)));
}
