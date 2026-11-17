/**
 * Servidor de Auth FALSO, só para o teste ponta a ponta do WMS sem Supabase local.
 * Implementa o mínimo usado pelo supabase-js: login por senha, /user e logout.
 * Os tokens são JWT HS256 com claims do Supabase; o supabase-js valida chamando
 * /auth/v1/user (mesmo caminho usado em produção com chaves simétricas).
 * Nunca usar fora de testes.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

type UsuarioFalso = { id: string; email: string; senha: string; aal: "aal1" | "aal2" };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export class AuthFalso {
  private usuarios = new Map<string, UsuarioFalso>();
  private tokens = new Map<string, UsuarioFalso>();
  private servidor: Server | null = null;
  constructor(public porta: number) {}

  get url() {
    return `http://127.0.0.1:${this.porta}`;
  }

  adicionar(u: UsuarioFalso) {
    this.usuarios.set(u.email, u);
  }

  private jwt(u: UsuarioFalso) {
    const agora = Math.floor(Date.now() / 1000);
    const corpo = { sub: u.id, aud: "authenticated", role: "authenticated", iss: `${this.url}/auth/v1`, email: u.email, aal: u.aal,
      amr: [{ method: u.aal === "aal2" ? "totp" : "password", timestamp: agora }], session_id: randomUUID(), iat: agora, exp: agora + 3600 };
    const cab = b64({ alg: "HS256", typ: "JWT" });
    const sem = `${cab}.${b64(corpo)}`;
    return `${sem}.${createHmac("sha256", "somente-teste").update(sem).digest("base64url")}`;
  }

  private usuarioJson(u: UsuarioFalso) {
    return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, factors: [], created_at: new Date().toISOString() };
  }

  iniciar(): Promise<void> {
    this.servidor = createServer((req, res) => {
      const responder = (status: number, corpo?: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
        res.end(corpo === undefined ? "" : JSON.stringify(corpo));
      };
      if (req.method === "OPTIONS") return responder(204);
      let bruto = "";
      req.on("data", (c) => (bruto += c));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", this.url);
        if (req.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
          const { email, password } = JSON.parse(bruto || "{}");
          const u = this.usuarios.get(email);
          if (!u || u.senha !== password) return responder(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
          const access = this.jwt(u);
          this.tokens.set(access, u);
          return responder(200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: randomUUID(), user: this.usuarioJson(u) });
        }
        if (req.method === "GET" && url.pathname === "/auth/v1/user") {
          const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
          const u = this.tokens.get(token);
          return u ? responder(200, this.usuarioJson(u)) : responder(401, { message: "invalid JWT" });
        }
        // Só para o teste: cadastra usuários do cenário (processo separado do Playwright).
        if (req.method === "POST" && url.pathname === "/__teste/usuarios") {
          for (const u of JSON.parse(bruto || "[]") as UsuarioFalso[]) this.adicionar(u);
          return responder(204);
        }
        // A vitrine da loja consulta o PostgREST no build: responde vazio (modo sem dados).
        if (req.method === "GET" && url.pathname.startsWith("/rest/v1/")) {
          return responder(200, []);
        }
        if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
          this.tokens.delete((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
          return responder(204);
        }
        return responder(404, { message: "não implementado no Auth falso" });
      });
    });
    return new Promise((r) => this.servidor!.listen(this.porta, "127.0.0.1", () => r()));
  }

  parar(): Promise<void> {
    return new Promise((r) => (this.servidor ? this.servidor.close(() => r()) : r()));
  }
}
