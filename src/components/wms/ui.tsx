"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/campos";
import { rotulo } from "@/lib/wms/estados";
import { interpretarLeitura, novoIdLeitura, type Terminador } from "@/lib/wms/scanner";
import { cn } from "@/lib/utils";

export function Titulo({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: React.ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </header>
  );
}

export function Painel({ className, children, titulo }: { className?: string; children: React.ReactNode; titulo?: string }) {
  return (
    <section className={cn("rounded-xl border border-borda bg-superficie p-4", className)}>
      {titulo && <h2 className="mb-3 text-base font-bold">{titulo}</h2>}
      {children}
    </section>
  );
}

const TOM: Record<string, "ok" | "alerta" | "erro" | "neutro" | "andamento"> = {
  dispatched: "ok", received: "ok", completed: "ok", sent: "ok", applied: "ok", closed: "ok", released: "ok", active: "ok", available: "ok", picked: "ok", packed: "ok",
  on_hold: "alerta", awaiting_review: "alerta", partially_received: "alerta", blocked: "alerta", unknown: "alerta", quarantine: "alerta", review: "alerta",
  reauthorization_required: "alerta", pending_authorization: "alerta", closed_with_discrepancy: "alerta", damaged: "alerta",
  cancelled: "erro", failed: "erro", rejected: "erro", invalidated: "erro",
  picking: "andamento", checking: "andamento", receiving: "andamento", in_progress: "andamento", counting: "andamento", loading: "andamento",
  processing: "andamento", in_transit: "andamento", pending: "andamento", allocated: "andamento", ready_to_dispatch: "andamento",
};

/** Estado com ícone + texto (não depende só da cor). */
export function Estado({ valor }: { valor: string | null | undefined }) {
  const tom = TOM[valor ?? ""] ?? "neutro";
  const Icone = { ok: CheckCircle2, alerta: AlertTriangle, erro: XCircle, andamento: Clock, neutro: CircleDashed }[tom];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
      tom === "ok" && "border-sucesso/50 text-sucesso", tom === "alerta" && "border-amarelo-texto/50 text-amarelo-texto",
      tom === "erro" && "border-perigo/50 text-perigo", tom === "andamento" && "border-rosa-texto/50 text-rosa-texto",
      tom === "neutro" && "border-borda text-suave")}>
      <Icone aria-hidden className="size-3.5" />
      {rotulo(valor)}
    </span>
  );
}

export function Mensagem({ m }: { m: { tipo: "ok" | "erro"; texto: string; dados?: unknown } | null }) {
  if (!m) return null;
  return (
    <div role={m.tipo === "erro" ? "alert" : "status"} aria-live="assertive"
      className={cn("my-3 flex items-start gap-2 rounded-lg border p-3 text-sm",
        m.tipo === "ok" ? "border-sucesso/50 bg-sucesso/10" : "border-perigo/50 bg-perigo/10")}>
      {m.tipo === "ok" ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-sucesso" /> : <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-perigo" />}
      <div>
        <p className="font-semibold">{m.tipo === "ok" ? "Confirmado" : "Não confirmado"}</p>
        <p>{m.texto}</p>
        {Array.isArray(m.dados) && m.dados.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs text-suave">
            {m.dados.slice(0, 8).map((d, i) => <li key={i}>{typeof d === "object" ? JSON.stringify(d) : String(d)}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Tabela({ colunas, linhas, vazio = "Nada por aqui." }: {
  colunas: { titulo: string; classe?: string }[];
  linhas: { chave: string; celulas: React.ReactNode[]; onClick?: () => void }[];
  vazio?: string;
}) {
  if (!linhas.length) return <p className="py-6 text-center text-sm text-suave">{vazio}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs uppercase text-suave">
          <tr>{colunas.map((c) => <th key={c.titulo} scope="col" className={cn("border-b border-borda px-2 py-2 font-semibold", c.classe)}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} className={cn("border-b border-borda/60", l.onClick && "cursor-pointer hover:bg-superficie-2")}
              onClick={l.onClick} onKeyDown={(e) => { if (l.onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); l.onClick(); } }}
              tabIndex={l.onClick ? 0 : undefined}>
              {l.celulas.map((c, i) => <td key={i} className="px-2 py-2 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const qtd = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "—";
};
export const dataHora = (v: unknown) => (v ? new Date(String(v)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

// ---------------------------------------------------------------------
// Leitura por scanner
// ---------------------------------------------------------------------
const CHAVE_PREF = "wms:scanner";
type Pref = { terminador: Terminador; som: boolean };
export function lerPreferencias(): Pref {
  try {
    return { terminador: "enter", som: true, ...JSON.parse(localStorage.getItem(CHAVE_PREF) ?? "{}") };
  } catch {
    return { terminador: "enter", som: true };
  }
}
export function salvarPreferencias(p: Pref) {
  try {
    localStorage.setItem(CHAVE_PREF, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}

export function bip(ok: boolean) {
  if (!lerPreferencias().som) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.35));
  } catch {
    /* sem áudio */
  }
}

export type Leitura = ReturnType<typeof interpretarLeitura> & { scanId: string };
export type CampoLeituraRef = { focar: () => void };

/** Campo que recebe a leitura do coletor (teclado) e devolve código + ID único da leitura. */
export const CampoLeitura = forwardRef<CampoLeituraRef, {
  rotulo: string;
  id: string;
  onLeitura: (l: Leitura) => void;
  desabilitado?: boolean;
  placeholder?: string;
}>(function CampoLeitura({ rotulo: r, id, onLeitura, desabilitado, placeholder }, ref) {
  const [valor, setValor] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focar: () => input.current?.focus() }));
  useEffect(() => {
    if (!desabilitado) input.current?.focus();
  }, [desabilitado]);
  const enviar = () => {
    const pref = lerPreferencias();
    const l = interpretarLeitura(valor, pref.terminador === "nenhum" ? "nenhum" : "enter");
    if (!l.codigo) return;
    onLeitura({ ...l, scanId: novoIdLeitura() });
    setValor("");
  };
  return (
    <div>
      <Label htmlFor={id}>{r}</Label>
      <div className="flex gap-2">
        <Input id={id} ref={input} value={valor} onChange={(e) => setValor(e.target.value)} disabled={desabilitado}
          inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={placeholder ?? "Leia ou digite o código"}
          className="h-14 font-mono text-lg"
          onKeyDown={(e) => {
            const pref = lerPreferencias();
            if ((e.key === "Enter" && pref.terminador !== "tab") || (e.key === "Tab" && pref.terminador === "tab")) {
              e.preventDefault();
              enviar();
            }
          }} />
        <Button type="button" size="lg" className="h-14 px-6" onClick={enviar} disabled={desabilitado || !valor}>OK</Button>
      </div>
    </div>
  );
});

export function CampoNumero({ id, rotulo: r, valor, onChange, min = 0, passo = 1 }: { id: string; rotulo: string; valor: number; onChange: (n: number) => void; min?: number; passo?: number }) {
  return (
    <div>
      <Label htmlFor={id}>{r}</Label>
      <Input id={id} type="number" inputMode="decimal" min={min} step={passo} value={Number.isFinite(valor) ? valor : ""}
        onChange={(e) => onChange(Number(e.target.value))} className="h-14 text-lg" />
    </div>
  );
}

export function Campo({ id, rotulo: r, ...props }: { id: string; rotulo: string } & React.ComponentProps<typeof Input>) {
  return (
    <div>
      <Label htmlFor={id}>{r}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

export function Progresso({ feito, total, unidade = "un" }: { feito: number; total: number; unidade?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : 0;
  return (
    <div aria-label={`Progresso: ${feito} de ${total} ${unidade}`}>
      <div className="mb-1 flex justify-between text-xs text-suave"><span>{qtd(feito)} de {qtd(total)} {unidade}</span><span>{pct}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-superficie-3"><div className="h-full bg-rosa" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function AvisoSimulado() {
  return (
    <p className="mb-3 rounded-lg border border-amarelo-texto/60 bg-amarelo/10 px-3 py-2 text-xs font-semibold text-amarelo-texto">
      MODO SIMULADO: conexão com o ERP fictício. Nada é enviado à Olist real.
    </p>
  );
}
