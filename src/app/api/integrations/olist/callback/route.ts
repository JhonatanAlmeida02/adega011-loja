/**
 * Retorno do OAuth da Olist. Valida o state (uso único, validade, hash), exige que
 * o mesmo administrador que iniciou esteja logado, troca o código no backend e
 * guarda os tokens cifrados. Redireciona sem expor detalhes técnicos.
 */
import { NextResponse, type NextRequest } from "next/server";
import { identidadeDaRequisicao } from "@/lib/wms/auth";
import { comoWorker, rpc } from "@/lib/wms/db";
import { cifrar, decifrar, hashSha256 } from "@/lib/wms/integracoes/cripto";
import { configOAuth, trocarCodigo } from "@/lib/wms/integracoes/oauth-olist";

export async function GET(req: NextRequest) {
  const destino = (resultado: string) => {
    const u = req.nextUrl.clone();
    u.pathname = "/wms/integracoes";
    u.search = `?oauth=${resultado}`;
    return NextResponse.redirect(u);
  };
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const conn = state?.split(".")[0] ?? "";
  if (!code || !state || !/^[0-9a-f-]{36}$/.test(conn) || code.length > 2000) return destino("invalido");
  try {
    const id = await identidadeDaRequisicao(req, false);
    const c = await comoWorker(async (x) => (await x.query("select oauth_started_by from wms.worker_get_connection($1)", [conn])).rows[0]);
    if (!c || c.oauth_started_by !== id.userId) return destino("usuario_diferente");
    const pkceCifrado = await comoWorker((x) => rpc<string>(x, "worker_consume_oauth_state", [conn, hashSha256(state)]));
    const verificador = pkceCifrado ? decifrar(pkceCifrado, `oauth:${conn}`) : undefined;
    const t = await trocarCodigo(configOAuth(), code, verificador);
    const cred = cifrar(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }), conn);
    await comoWorker((x) => rpc(x, "worker_save_authorized_credentials", [
      conn, cred.ciphertext, cred.versao, new Date(Date.now() + t.expires_in * 1000).toISOString(),
      t.refresh_expires_in ? new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() : null,
    ]));
    return destino("ok");
  } catch (e) {
    console.error(JSON.stringify({ nivel: "erro", origem: "wms.oauth", erro: e instanceof Error ? e.name : "erro" }));
    return destino("falhou");
  }
}
