"use client";

import { createContext } from "react";
import type { FotosPreparadas } from "@/lib/fotos-preparadas";

export const FotosPreparadasContext = createContext<FotosPreparadas>({});

export function FotosPreparadasProvider({ fotos, children }: { fotos: FotosPreparadas; children: React.ReactNode }) {
  return <FotosPreparadasContext.Provider value={fotos}>{children}</FotosPreparadasContext.Provider>;
}
