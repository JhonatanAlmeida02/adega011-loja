import { NextResponse, type NextRequest } from "next/server";
import { comando, consulta } from "@/lib/wms/api";
import { rpc } from "@/lib/wms/db";
import { casarRota, COMANDOS, CONSULTAS } from "@/lib/wms/rotas";

type Rota = { params: Promise<{ rota: string[] }> };

const naoEncontrada = () => NextResponse.json({ erro: "rota_inexistente", mensagem: "Rota não encontrada." }, { status: 404 });

export async function GET(req: NextRequest, ctx: Rota) {
  const { rota } = await ctx.params;
  const m = casarRota(CONSULTAS, rota);
  if (!m) return naoEncontrada();
  return consulta((c) => m.def.executar(c, req.nextUrl.searchParams, m.params))(req, { params: Promise.resolve(m.params) });
}

export async function POST(req: NextRequest, ctx: Rota) {
  const { rota } = await ctx.params;
  const m = casarRota(COMANDOS, rota);
  if (!m) return naoEncontrada();
  return comando(m.def.schema, (c, entrada, x) => rpc(c, m.def.fn, m.def.args(entrada, m.params, x.chave ?? "")), {
    exigeChave: !m.def.semChave,
  })(req, { params: Promise.resolve(m.params) });
}
