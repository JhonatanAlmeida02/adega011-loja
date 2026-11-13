/**
 * Resposta leve para manter o servidor acordado (hospedagem gratuita do Render
 * dorme após 15 min sem visitas). Quem chama é o próprio Supabase, só no
 * horário de funcionamento: veja supabase/migrations/*_manter_servidor_acordado.sql.
 */
export function GET() {
  return new Response("ok", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
