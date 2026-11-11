"use client";

import { Toaster } from "sonner";
import { useTema } from "./use-tema";

/** Avisos (toasts) com as cores do tema atual. */
export function Notificacoes() {
  const [tema] = useTema();
  return (
    <Toaster
      theme={tema === "claro" ? "light" : "dark"}
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--color-superficie-2)",
          border: "1px solid var(--color-borda)",
          color: "var(--color-texto)",
          fontFamily: "var(--font-dm-sans)",
        },
      }}
    />
  );
}
