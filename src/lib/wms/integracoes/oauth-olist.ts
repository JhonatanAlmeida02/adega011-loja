/**
 * OAuth 2.0 (Authorization Code) da Olist conforme
 * https://api-docs.erp.olist.com/documentacao/comecando/autenticacao (17/11/2026):
 *  autorização: https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth
 *  token:       https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token
 * A documentação não menciona PKCE: fica desligado salvo OLIST_OAUTH_PKCE=true (validar antes).
 * A duração dos tokens vem da resposta (expires_in/refresh_expires_in); não é fixada no código.
 */
import { createHash } from "node:crypto";
import { ErroErp } from "./tipos";

export const OLIST_AUTH_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
export const OLIST_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

export type ConfigOAuth = { clientId: string; clientSecret: string; redirectUri: string; pkce: boolean };

export function configOAuth(env: NodeJS.ProcessEnv = process.env): ConfigOAuth {
  const clientId = env.OLIST_CLIENT_ID ?? "";
  const clientSecret = env.OLIST_CLIENT_SECRET ?? "";
  const redirectUri = env.OLIST_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ErroErp("permanente", "OAuth da Olist não configurado (OLIST_CLIENT_ID/SECRET/REDIRECT_URI).", undefined, undefined, "oauth_not_configured");
  }
  if (!/^https:\/\//.test(redirectUri) && !/^http:\/\/localhost[:/]/.test(redirectUri)) {
    throw new ErroErp("permanente", "OLIST_REDIRECT_URI precisa ser HTTPS (ou localhost em desenvolvimento).");
  }
  return { clientId, clientSecret, redirectUri, pkce: env.OLIST_OAUTH_PKCE === "true" };
}

export function urlAutorizacao(cfg: ConfigOAuth, state: string, verificadorPkce?: string): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: "openid", response_type: "code", state });
  if (cfg.pkce && verificadorPkce) {
    q.set("code_challenge", createHash("sha256").update(verificadorPkce).digest("base64url"));
    q.set("code_challenge_method", "S256");
  }
  return `${OLIST_AUTH_URL}?${q}`;
}

export type Tokens = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number };

async function postarToken(corpo: URLSearchParams, fetchImpl: typeof fetch): Promise<Tokens> {
  let resp: Response;
  try {
    resp = await fetchImpl(OLIST_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: corpo,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ErroErp("transitorio", "Falha de comunicação com o servidor de autenticação.");
  }
  const dados = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (resp.status === 400 || resp.status === 401) {
    // invalid_grant: refresh expirado/revogado → reautorização
    throw new ErroErp("autorizacao", `Autorização recusada (${String(dados.error ?? resp.status)}).`, resp.status, undefined, String(dados.error ?? "invalid_grant"));
  }
  if (!resp.ok) throw new ErroErp("transitorio", `Servidor de autenticação respondeu ${resp.status}.`, resp.status);
  if (typeof dados.access_token !== "string" || typeof dados.refresh_token !== "string" || typeof dados.expires_in !== "number") {
    throw new ErroErp("permanente", "Resposta de token fora do contrato.", resp.status, undefined, "contract_mismatch");
  }
  return {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    expires_in: dados.expires_in,
    refresh_expires_in: typeof dados.refresh_expires_in === "number" ? dados.refresh_expires_in : undefined,
  };
}

export function trocarCodigo(cfg: ConfigOAuth, code: string, verificadorPkce: string | undefined, fetchImpl: typeof fetch = fetch) {
  const corpo = new URLSearchParams({
    grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, code,
  });
  if (cfg.pkce && verificadorPkce) corpo.set("code_verifier", verificadorPkce);
  return postarToken(corpo, fetchImpl);
}

export function renovarToken(cfg: ConfigOAuth, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return postarToken(new URLSearchParams({
    grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken,
  }), fetchImpl);
}
