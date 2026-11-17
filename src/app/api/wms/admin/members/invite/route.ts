/**
 * Convite de usuário (cadastro só por convite). Ordem: autoriza (users.manage + MFA)
 * → convida pelo Supabase Auth com a chave secreta (só no servidor) → grava o vínculo.
 * Nenhuma senha passa pelo WMS.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { respostaErro } from "@/lib/wms/api";
import { identidadeDaRequisicao } from "@/lib/wms/auth";
import { comoUsuario, rpc } from "@/lib/wms/db";
import { WmsErro } from "@/lib/wms/erros";

const schema = z.object({
  organization_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  full_name: z.string().trim().max(120).default(""),
  roles: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1),
  all_warehouses: z.boolean().default(false),
  warehouse_ids: z.array(z.string().uuid()).default([]),
});

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const id = await identidadeDaRequisicao(req, true);
    const r = schema.safeParse(await req.json().catch(() => null));
    if (!r.success) throw new WmsErro(422, "entrada_invalida", "Dados do convite inválidos.");
    const e = r.data;
    await comoUsuario(id, (c) => rpc(c, "require", [e.organization_id, "users.manage", null]), correlationId);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secreta = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !secreta) throw new WmsErro(503, "convite_indisponivel", "Convite indisponível: chave secreta do Supabase não configurada no servidor.");
    const adminSb = createClient(url, secreta, { auth: { persistSession: false, autoRefreshToken: false } });
    const app = process.env.APP_URL ?? req.nextUrl.origin;
    const { data, error } = await adminSb.auth.admin.inviteUserByEmail(e.email, { redirectTo: `${app}/wms/login` });
    if (error || !data.user) {
      // Mensagem neutra: não revela se o e-mail já tem conta.
      throw new WmsErro(409, "convite_recusado", "Não foi possível convidar este e-mail. Se a pessoa já tem acesso ao Supabase, inclua o vínculo pela lista de usuários.");
    }
    const resultado = await comoUsuario(id, (c) => rpc(c, "save_member",
      [e.organization_id, data.user.id, e.full_name, e.roles, e.all_warehouses, e.warehouse_ids]), correlationId);
    return NextResponse.json({ ...resultado, invited: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return respostaErro(err, correlationId);
  }
}
