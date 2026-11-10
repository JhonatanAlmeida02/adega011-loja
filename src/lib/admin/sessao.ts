"use client";

import { useEffect, useState } from "react";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";

export type EstadoSessao =
  | { estado: "carregando" }
  | { estado: "sem-supabase" }
  | { estado: "anonimo" }
  | { estado: "negado"; email: string }
  | { estado: "ok"; email: string };

/** Confere se há usuário logado e se ele está na tabela admins. */
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
      const { data } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!ativo) return;
      setSessao(data ? { estado: "ok", email: user.email ?? "" } : { estado: "negado", email: user.email ?? "" });
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
