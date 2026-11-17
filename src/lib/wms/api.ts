/**
 * Helpers das rotas /api/wms: autenticação, limite de requisições, validação
 * (Zod), chave de idempotência, correlation_id e respostas de erro seguras.
 * 401 sem autenticação · 403 sem permissão · 409 conflito/estado/versão · 422 entrada inválida.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { z } from "zod";
import { identidadeDaRequisicao } from "./auth";
import { comoUsuario, type Identidade } from "./db";
import { WmsErro } from "./erros";

const LIMITE_CORPO = 64 * 1024;

// Limite simples por IP e por instância (proteção básica; o banco é a defesa real contra duplicidade).
const janelas = new Map<string, { inicio: number; n: number }>();
function limitarRequisicoes(req: NextRequest, limitePorMinuto = Number(process.env.WMS_API_RATE_PER_MIN ?? 300)) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const agora = Date.now();
  const j = janelas.get(ip);
  if (!j || agora - j.inicio > 60_000) {
    janelas.set(ip, { inicio: agora, n: 1 });
    if (janelas.size > 10_000) janelas.clear();
    return;
  }
  if (++j.n > limitePorMinuto) throw new WmsErro(429, "muitas_requisicoes", "Muitas requisições. Aguarde um instante.");
}

export function respostaErro(e: unknown, correlationId: string): NextResponse {
  const erro = e instanceof WmsErro ? e : null;
  if (!erro) {
    console.error(JSON.stringify({ nivel: "erro", origem: "wms.api", correlation_id: correlationId, erro: e instanceof Error ? e.message : String(e) }));
  }
  const status = erro?.status ?? 500;
  return NextResponse.json(
    {
      erro: erro?.codigo ?? "erro_interno",
      mensagem: erro?.message ?? "Erro interno. Informe o código de correlação ao suporte.",
      ...(erro?.dados !== undefined ? { dados: erro.dados } : {}),
      correlation_id: correlationId,
    },
    { status, headers: { "x-correlation-id": correlationId, "cache-control": "no-store" } },
  );
}

export const uuidSchema = z.string().uuid();
const chaveSchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,200}$/);

type Ctx<P> = { req: NextRequest; id: Identidade; params: P; correlationId: string; chave: string | null };

async function lerCorpo(req: NextRequest): Promise<unknown> {
  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json")) throw new WmsErro(415, "tipo_invalido", "Envie JSON (Content-Type: application/json).");
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO) throw new WmsErro(413, "corpo_grande", "Requisição grande demais.");
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw new WmsErro(422, "json_invalido", "JSON inválido.");
  }
}

/**
 * Comando (POST): exige Idempotency-Key (cabeçalho) e executa numa transação com o contexto do usuário.
 */
export function comando<S extends z.ZodType, P = Record<string, string>>(
  schema: S,
  executar: (c: PoolClient, entrada: z.infer<S>, ctx: Ctx<P>) => Promise<unknown>,
  opcoes: { exigeChave?: boolean } = {},
) {
  return async (req: NextRequest, rota: { params: Promise<P> }) => {
    const correlationId = req.headers.get("x-correlation-id")?.slice(0, 64).replace(/[^A-Za-z0-9-]/g, "") || randomUUID();
    try {
      limitarRequisicoes(req);
      const id = await identidadeDaRequisicao(req, true);
      const chave = req.headers.get("idempotency-key");
      if (opcoes.exigeChave !== false && !chaveSchema.safeParse(chave).success) {
        throw new WmsErro(422, "chave_idempotencia", "Cabeçalho Idempotency-Key ausente ou inválido.");
      }
      const corpo = await lerCorpo(req);
      const r = schema.safeParse(corpo);
      if (!r.success) {
        throw new WmsErro(422, "entrada_invalida", "Dados inválidos.", undefined, r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })));
      }
      const params = await rota.params;
      const resultado = await comoUsuario(id, (c) => executar(c, r.data, { req, id, params, correlationId, chave }), correlationId);
      return NextResponse.json(resultado ?? {}, { headers: { "x-correlation-id": correlationId, "cache-control": "no-store" } });
    } catch (e) {
      return respostaErro(e, correlationId);
    }
  };
}

/** Consulta (GET): somente leitura com RLS. */
export function consulta<P = Record<string, string>>(executar: (c: PoolClient, ctx: Ctx<P>) => Promise<unknown>) {
  return async (req: NextRequest, rota: { params: Promise<P> }) => {
    const correlationId = randomUUID();
    try {
      limitarRequisicoes(req);
      const id = await identidadeDaRequisicao(req, false);
      const params = await rota.params;
      const resultado = await comoUsuario(id, (c) => executar(c, { req, id, params, correlationId, chave: null }), correlationId);
      return NextResponse.json(resultado ?? {}, { headers: { "x-correlation-id": correlationId, "cache-control": "no-store" } });
    } catch (e) {
      return respostaErro(e, correlationId);
    }
  };
}

/** Paginação padronizada para listas. */
export function paginacao(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limite = Math.min(Math.max(Number(p.get("limite") ?? 50) || 50, 1), 200);
  const pagina = Math.max(Number(p.get("pagina") ?? 1) || 1, 1);
  return { limite, offset: (pagina - 1) * limite, pagina };
}

export function paramUuid(v: string | null | undefined, nome: string): string {
  const r = uuidSchema.safeParse(v);
  if (!r.success) throw new WmsErro(422, "parametro_invalido", `Parâmetro ${nome} inválido.`);
  return r.data;
}
