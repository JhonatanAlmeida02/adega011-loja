"use client";

import { useEffect } from "react";

/** Registra o service worker (apenas em produção) para o app ser instalável. */
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* sem service worker: a loja funciona normalmente */
    });
  }, []);
  return null;
}
