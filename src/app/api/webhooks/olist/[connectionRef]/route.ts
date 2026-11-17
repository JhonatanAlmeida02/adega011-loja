/**
 * Receptor de webhooks da Olist.
 * A documentação oficial (17/11/2026) NÃO descreve assinatura nem formato do
 * corpo: o aviso é tratado como sinal NÃO confiável. Aqui só persistimos na
 * inbox (HTTP 200 depois da gravação durável); o worker consulta o registro na
 * API autenticada antes de qualquer mudança. Quantidade/aprovação do corpo são ignoradas.
 * Configure uma URL por tipo: ...?tipo=vendas | enviados | estoque | notas
 */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { comoWorker, json, rpc } from "@/lib/wms/db";
import { WmsErro } from "@/lib/wms/erros";

const TIPOS = new Set(["vendas", "enviados", "estoque", "notas"]);
const LIMITE = 256 * 1024;

/** Melhor esforço para achar um ID numérico; sem ID, o worker faz sincronização incremental. */
function idDoAviso(corpo: unknown): string | null {
  const o = (corpo ?? {}) as Record<string, unknown>;
  const dados = (o.dados ?? {}) as Record<string, unknown>;
  for (const v of [dados.id, dados.idPedido, dados.idProduto, o.id, o.idPedido, o.idProduto]) {
    if ((typeof v === "number" || typeof v === "string") && /^[0-9]{1,20}$/.test(String(v))) return String(v);
  }
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ connectionRef: string }> }) {
  const { connectionRef } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(connectionRef)) return NextResponse.json({ ok: false }, { status: 404 });
  const tipo = req.nextUrl.searchParams.get("tipo") ?? "";
  if (!TIPOS.has(tipo)) return NextResponse.json({ ok: false, erro: "tipo_invalido" }, { status: 400 });
  const texto = await req.text();
  if (texto.length > LIMITE) return NextResponse.json({ ok: false }, { status: 413 });
  let corpo: unknown;
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch {
    return NextResponse.json({ ok: false, erro: "json_invalido" }, { status: 400 });
  }
  // Sem ID de evento documentado: deduplica por tipo + hash do corpo (reenvios idênticos da Olist).
  const dedup = `${tipo}:${createHash("sha256").update(texto).digest("hex")}`;
  try {
    const r = await comoWorker((c) => rpc<{ duplicate: boolean }>(c, "inbox_receive", [connectionRef, dedup, tipo, idDoAviso(corpo), json(corpo)]));
    return NextResponse.json({ ok: true, duplicate: r.duplicate });
  } catch (e) {
    if (e instanceof WmsErro && e.status === 404) return NextResponse.json({ ok: false }, { status: 404 });
    // Não confirma (sem 200): a Olist reenvia.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
