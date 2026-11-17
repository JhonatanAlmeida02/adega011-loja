/**
 * Health check do backend do WMS: banco acessível e idade do evento de integração
 * mais antigo pendente (alerta de fila parada). Não expõe dados de negócio.
 */
import { connection, NextResponse } from "next/server";
import { bancoWmsConfigurado, comoWorker } from "@/lib/wms/db";

export async function GET() {
  await connection();
  if (!bancoWmsConfigurado()) return NextResponse.json({ ok: false, banco: "nao_configurado" }, { status: 503 });
  try {
    const r = await comoWorker(async (c) => (await c.query(`
      select (select extract(epoch from now() - min(created_at))::int from wms.outbox_events where status in ('pending','processing')) as outbox_s,
             (select extract(epoch from now() - min(received_at))::int from wms.inbox_events where status in ('pending','processing')) as inbox_s,
             (select count(*)::int from wms.integration_connections where status = 'reauthorization_required') as reauth`)).rows[0]);
    const limite = Number(process.env.WMS_ALERTA_FILA_S ?? 900);
    const parada = (r.outbox_s ?? 0) > limite || (r.inbox_s ?? 0) > limite;
    return NextResponse.json({ ok: !parada && r.reauth === 0, fila_outbox_s: r.outbox_s, fila_inbox_s: r.inbox_s, reautorizacao: r.reauth },
      { status: parada ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, banco: "indisponivel" }, { status: 503 });
  }
}
