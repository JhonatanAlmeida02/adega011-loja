/**
 * Inicia a autorização OAuth da conta Olist (somente administrador com MFA).
 * O `state` é aleatório, de uso único, com validade, e só o hash fica no banco.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { respostaErro } from "@/lib/wms/api";
import { identidadeDaRequisicao } from "@/lib/wms/auth";
import { comoUsuario, rpc } from "@/lib/wms/db";
import { WmsErro } from "@/lib/wms/erros";
import { aleatorioUrl, cifrar, hashSha256 } from "@/lib/wms/integracoes/cripto";
import { configOAuth, urlAutorizacao } from "@/lib/wms/integracoes/oauth-olist";

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const id = await identidadeDaRequisicao(req, true);
    const r = z.object({ connection_id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
    if (!r.success) throw new WmsErro(422, "entrada_invalida", "Informe a conexão.");
    let cfg;
    try {
      cfg = configOAuth();
    } catch {
      throw new WmsErro(503, "oauth_nao_configurado", "OAuth da Olist não configurado no servidor.");
    }
    const state = `${r.data.connection_id}.${aleatorioUrl(32)}`;
    const verificador = aleatorioUrl(48);
    const pkce = cifrar(verificador, `oauth:${r.data.connection_id}`);
    await comoUsuario(id, (c) => rpc(c, "begin_oauth", [r.data.connection_id, hashSha256(state), pkce.ciphertext, 600]), correlationId);
    return NextResponse.json({ url: urlAutorizacao(cfg, state, verificador) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return respostaErro(e, correlationId);
  }
}
