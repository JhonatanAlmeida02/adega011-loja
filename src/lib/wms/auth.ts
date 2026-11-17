/**
 * Identidade do usuário nas rotas /api/wms (somente servidor).
 *  - JWT validado pela biblioteca oficial (supabase.auth.getClaims: assinatura via
 *    JWKS ou consulta ao Auth), mais emissor, audiência, papel e expiração.
 *  - Aceita sessão por cookie (navegador) ou Authorization: Bearer (coletor).
 *  - Mutação com cookie exige Origin do próprio site (proteção CSRF).
 *  - Só claims da lista abaixo seguem para o banco: user_metadata/app_metadata
 *    nunca autorizam nada.
 */
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import type { Identidade } from "./db";
import { WmsErro } from "./erros";

const URL_SUPABASE = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const CHAVE_PUBLICA = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function origemPermitida(req: NextRequest): boolean {
  const origem = req.headers.get("origin");
  if (!origem) return false;
  const permitidas = new Set<string>([req.nextUrl.origin]);
  const app = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (app) {
    try {
      permitidas.add(new URL(app).origin);
    } catch {
      /* ignora valor inválido */
    }
  }
  return permitidas.has(origem);
}

const CLAIMS_REPASSADOS = ["sub", "aal", "exp", "iat", "iss", "aud", "role", "session_id", "amr"] as const;

export async function identidadeDaRequisicao(req: NextRequest, mutacao: boolean): Promise<Identidade> {
  if (!URL_SUPABASE() || !CHAVE_PUBLICA()) {
    throw new WmsErro(503, "auth_nao_configurado", "Autenticação não configurada (Supabase).");
  }
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (mutacao && !bearer && !origemPermitida(req)) {
    throw new WmsErro(403, "origem_invalida", "Origem da requisição não permitida.");
  }
  const supabase = createServerClient(URL_SUPABASE(), CHAVE_PUBLICA(), {
    cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined },
  });
  const { data, error } = await supabase.auth.getClaims(bearer);
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || !claims || typeof claims.sub !== "string") {
    throw new WmsErro(401, "nao_autenticado", "Sessão inválida ou expirada. Entre novamente.");
  }
  const iss = `${URL_SUPABASE().replace(/\/+$/, "")}/auth/v1`;
  const aud = claims.aud;
  const audOk = aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated"));
  const exp = Number(claims.exp);
  if (claims.iss !== iss || !audOk || claims.role !== "authenticated" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new WmsErro(401, "token_invalido", "Sessão inválida ou expirada. Entre novamente.");
  }
  const repassados: Record<string, unknown> = {};
  for (const k of CLAIMS_REPASSADOS) if (claims[k] !== undefined) repassados[k] = claims[k];
  return { userId: claims.sub, claims: repassados };
}
