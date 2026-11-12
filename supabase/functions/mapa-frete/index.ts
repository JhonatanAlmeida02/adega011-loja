// Edge Function "mapa-frete" (Supabase / Deno)
//
// GET /functions/v1/mapa-frete?id=<id da cotação>
// Devolve a imagem do mapa (Google Maps Static API) com a loja, o endereço do
// cliente e o trajeto de carro calculado em cotar-frete. A chave do Google
// fica só aqui no servidor; o navegador recebe apenas a imagem.
//
// Segredos: GOOGLE_MAPS_API_KEY (com a Maps Static API ativada na chave).
// MAPS_FAKE=1 (só testes): devolve um desenho simples, sem chamar o Google.

const CORS = { "Access-Control-Allow-Origin": "*" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mapas só para cotações recentes: limita o uso da cota do Google por terceiros.
const VALIDADE_MS = 3 * 60 * 60 * 1000;

const erro = (status: number) => new Response(null, { status, headers: CORS });

function chaveDeServico(): string {
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof chaves.default === "string" && chaves.default) return chaves.default;
  } catch {
    /* segue para as outras */
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

async function ler(caminho: string) {
  const chave = chaveDeServico();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/${caminho}`, {
    headers: { apikey: chave, ...(chave.startsWith("eyJ") ? { Authorization: `Bearer ${chave}` } : {}) },
  });
  if (!r.ok) {
    console.error("[mapa-frete] banco", caminho.split("?")[0], r.status, (await r.text()).slice(0, 200));
    return null;
  }
  return (await r.json())?.[0] ?? null;
}

const desenhoDeTeste = () =>
  new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" fill="#e8e8e8"/><path d="M80 240 C 220 120, 380 260, 560 80" stroke="#FF5C8A" stroke-width="8" fill="none"/><circle cx="80" cy="240" r="14" fill="#FF5C8A"/><circle cx="560" cy="80" r="14" fill="#0B0B0B"/></svg>`,
    { headers: { ...CORS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } },
  );

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (req.method !== "GET") return erro(405);

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return erro(400);

  const cot = await ler(`cotacoes_frete?id=eq.${id}&select=rota,destino_lat,destino_lng,criado_em`);
  if (!cot || Date.now() - new Date(cot.criado_em).getTime() > VALIDADE_MS) return erro(404);
  if (Deno.env.get("MAPS_FAKE") === "1") return desenhoDeTeste();
  if (!cot.rota || cot.destino_lat == null) return erro(404);

  const cfg = await ler("configuracoes?id=eq.1&select=loja_lat,loja_lng");
  const chave = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!cfg || cfg.loja_lat == null || !chave) return erro(503);

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("size", "640x320");
  url.searchParams.set("scale", "2");
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "BR");
  // Cores da marca: loja em rosa (L), cliente em preto (C), trajeto em rosa
  url.searchParams.append("markers", `color:0xFF5C8A|label:L|${cfg.loja_lat},${cfg.loja_lng}`);
  url.searchParams.append("markers", `color:0x0B0B0B|label:C|${cot.destino_lat},${cot.destino_lng}`);
  url.searchParams.set("path", `color:0xFF5C8AFF|weight:5|enc:${cot.rota}`);
  url.searchParams.set("key", chave);

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const tipo = r.headers.get("content-type") ?? "";
    if (!r.ok || !tipo.startsWith("image/")) {
      console.error("[mapa-frete] Static Maps", r.status, (await r.text()).slice(0, 200));
      return erro(502);
    }
    return new Response(r.body, {
      headers: { ...CORS, "Content-Type": tipo, "Cache-Control": "public, max-age=10800, immutable" },
    });
  } catch (e) {
    console.error("[mapa-frete]", e);
    return erro(502);
  }
});
