"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useDados } from "./api-cliente";

export type Armazem = { id: string; code: string; name: string };
export type Vinculo = {
  organization_id: string;
  organization_code: string;
  organization_name: string;
  require_mfa: boolean;
  roles: string[];
  permissions: string[];
  warehouses: Armazem[];
};
export type Me = { user_id: string; aal: string; profile: { full_name: string; active: boolean } | null; memberships: Vinculo[] };

type Ctx = {
  me: Me;
  org: Vinculo;
  armazem: Armazem | null;
  setArmazem: (id: string) => void;
  pode: (permissao: string) => boolean;
  recarregar: () => void;
};

const WmsCtx = createContext<Ctx | null>(null);

const CHAVE_ARMAZEM = "wms:armazem";

export function ProvedorWms({ children, carregando, semAcesso }: {
  children: React.ReactNode;
  carregando: React.ReactNode;
  semAcesso: (me: Me | null, erro: string | null) => React.ReactNode;
}) {
  const { dados: me, erro, carregando: carregandoMe, recarregar } = useDados<Me>("me");
  const [whId, setWhId] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(CHAVE_ARMAZEM);
    } catch {
      return null; // armazenamento indisponível: usa o primeiro armazém
    }
  });
  const org = me?.memberships[0] ?? null;
  const valor = useMemo<Ctx | null>(() => {
    if (!me || !org) return null;
    const armazem = org.warehouses.find((w) => w.id === whId) ?? org.warehouses[0] ?? null;
    return {
      me,
      org,
      armazem,
      setArmazem: (id) => {
        setWhId(id);
        try {
          localStorage.setItem(CHAVE_ARMAZEM, id);
        } catch {
          /* ignora */
        }
      },
      // Só esconde/mostra na interface. A autorização real é feita no servidor em cada operação.
      pode: (p) => org.permissions.includes(p),
      recarregar: () => void recarregar(),
    };
  }, [me, org, whId, recarregar]);
  if (carregandoMe && !me) return <>{carregando}</>;
  if (!valor) return <>{semAcesso(me, erro?.message ?? null)}</>;
  return <WmsCtx.Provider value={valor}>{children}</WmsCtx.Provider>;
}

export function useWms(): Ctx {
  const c = useContext(WmsCtx);
  if (!c) throw new Error("useWms fora do ProvedorWms");
  return c;
}
