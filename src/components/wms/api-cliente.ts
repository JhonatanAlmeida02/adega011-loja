"use client";

/**
 * Cliente da API do WMS no navegador/coletor.
 * - Cada AÇÃO intencional gera uma Idempotency-Key; retentativas de rede reutilizam a mesma.
 * - Botão desabilitado durante o envio é só UX: a prevenção real de duplicidade é no servidor.
 */
import { useCallback, useEffect, useState } from "react";

export class ErroApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public dados?: unknown,
    public correlationId?: string,
  ) {
    super(mensagem);
  }
}

async function tratar<T>(r: Response): Promise<T> {
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/wms/login")) {
    location.href = `/wms/login?volta=${encodeURIComponent(location.pathname)}`;
  }
  if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? "erro", corpo.mensagem ?? `Erro ${r.status}`, corpo.dados, corpo.correlation_id);
  return corpo as T;
}

export async function wmsGet<T = unknown>(caminho: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const r = await fetch(`/api/wms/${caminho}${q.size ? `?${q}` : ""}`, { credentials: "same-origin", cache: "no-store" });
  return tratar<T>(r);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST com retentativa só para falha de REDE, reaproveitando a mesma chave. */
export async function wmsPost<T = Record<string, unknown>>(caminho: string, corpo: unknown, chave: string = crypto.randomUUID(), base = "/api/wms/"): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    let r: Response;
    try {
      r = await fetch(`${base}${caminho}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": chave },
        body: JSON.stringify(corpo ?? {}),
      });
    } catch {
      if (tentativa < 3) {
        await esperar(400 * tentativa);
        continue;
      }
      throw new ErroApi(0, "rede", "Sem conexão com o servidor. A operação NÃO foi confirmada; tente de novo.");
    }
    return tratar<T>(r);
  }
}

/** Carrega dados e recarrega sob demanda (recarregar() dispara uma nova busca). */
export function useDados<T>(caminho: string | null, params: Record<string, string | number | boolean | null | undefined> = {}) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [rodada, setRodada] = useState(0);
  const chaveParams = JSON.stringify(params);
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    wmsGet<T>(caminho, JSON.parse(chaveParams))
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setErro(null);
      })
      .catch((e) => {
        if (vivo) setErro(e instanceof ErroApi ? e : new ErroApi(0, "erro", String(e)));
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [caminho, chaveParams, rodada]);
  const recarregar = useCallback(async () => setRodada((n) => n + 1), []);
  return { dados, erro, carregando, recarregar };
}

/** Executa um comando com estado de envio e mensagem de resultado. */
export function useComando() {
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string; dados?: unknown } | null>(null);
  const executar = useCallback(async <T,>(caminho: string, corpo: unknown, opcoes: { ok?: string | ((r: T) => string); chave?: string } = {}) => {
    setEnviando(true);
    setMensagem(null);
    try {
      const r = await wmsPost<T>(caminho, corpo, opcoes.chave);
      const texto = typeof opcoes.ok === "function" ? opcoes.ok(r) : (opcoes.ok ?? "Confirmado no WMS.");
      setMensagem({ tipo: "ok", texto });
      return r;
    } catch (e) {
      const err = e instanceof ErroApi ? e : new ErroApi(0, "erro", String(e));
      setMensagem({ tipo: "erro", texto: err.message + (err.correlationId ? ` (código ${err.correlationId.slice(0, 8)})` : ""), dados: err.dados });
      return null;
    } finally {
      setEnviando(false);
    }
  }, []);
  return { executar, enviando, mensagem, setMensagem };
}
