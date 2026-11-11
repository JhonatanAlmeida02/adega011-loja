// Edge Function "cotar-frete" (Supabase / Deno)
//
// Recebe o endereço do cliente, calcula os km rodados da loja até lá pelo
// Google Maps e grava uma cotação em public.cotacoes_frete. O pedido
// (criar_pedido) só aceita a taxa de uma cotação gravada aqui — assim o
// navegador nunca define o valor do frete.
//
// Segredos (Supabase > Edge Functions > Secrets):
//   GOOGLE_MAPS_API_KEY  chave com Geocoding API e Routes API ativadas
//   MAPS_FAKE=1          (só testes) inventa os km sem chamar o Google
// Sem dependências externas: fala com o banco pela API REST (PostgREST).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const normalizar = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const limpar = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

type Ponto = { lat: number; lng: number; formatado: string };

/** Chave secreta do projeto: a nova (SUPABASE_SECRET_KEYS) ou, se não houver, a antiga. */
function chaveDeServico(): string {
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof chaves.default === "string" && chaves.default) return chaves.default;
  } catch {
    /* segue para as outras */
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

/** Chamada à API REST do próprio projeto com a chave de serviço (ignora RLS). */
function criarBanco() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const chave = chaveDeServico();
  // Chaves novas (sb_secret_...) não são JWT: vão só no cabeçalho apikey.
  // A chave antiga (service_role, um JWT) também vai em Authorization.
  const auth: Record<string, string> = chave.startsWith("eyJ") ? { Authorization: `Bearer ${chave}` } : {};
  return async (caminho: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/${caminho}`, {
      ...init,
      headers: {
        apikey: chave,
        ...auth,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const texto = await r.text();
    if (!r.ok) console.error("[cotar-frete] banco", init.method ?? "GET", caminho.split("?")[0], r.status, texto.slice(0, 300));
    return { ok: r.ok, status: r.status, headers: r.headers, dados: texto ? JSON.parse(texto) : null };
  };
}

async function geocodificar(endereco: string, chave: string): Promise<Ponto | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", endereco);
  url.searchParams.set("key", chave);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("components", "country:BR");
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const d = await r.json();
  if (d.status === "ZERO_RESULTS") return null;
  if (d.status !== "OK") throw new Error(`Geocoding: ${d.status} ${d.error_message ?? ""}`);
  const res = d.results[0];
  // APPROXIMATE = só achou cidade/bairro; não serve para calcular a entrega
  if (res.geometry.location_type === "APPROXIMATE") return null;
  return { lat: res.geometry.location.lat, lng: res.geometry.location.lng, formatado: res.formatted_address };
}

async function distanciaMetros(a: Ponto, b: Ponto, chave: string): Promise<number> {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": chave,
      "X-Goog-FieldMask": "routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      languageCode: "pt-BR",
      units: "METRIC",
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Routes: ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  const m = d.routes?.[0]?.distanceMeters;
  if (typeof m !== "number") throw new Error("Routes: sem rota");
  return m;
}

// Modo de teste: "[km=4.2]" no endereço define os km; senão um valor fixo por endereço.
function kmFalso(endereco: string): number {
  const marcado = endereco.match(/km\s*=\s*(\d+(?:[.,]\d+)?)/i);
  if (marcado) return Number(marcado[1].replace(",", "."));
  let h = 0;
  for (const c of normalizar(endereco)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 1 + (h % 90) / 10; // 1,0 a 9,9 km
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "Método não permitido." });

  const banco = criarBanco();

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "Requisição inválida." });
  }
  const rua = limpar(corpo.rua, 150);
  const bairro = limpar(corpo.bairro, 80);
  const cidadeInformada = limpar(corpo.cidade, 80);
  if (rua.length < 5 || !/\d/.test(rua)) return resposta(422, { erro: "Informe a rua e o número." });
  if (bairro.length < 2) return resposta(422, { erro: "Informe o bairro." });

  const rCfg = await banco(
    "configuracoes?id=eq.1&select=modo_frete,taxa_base,taxa_por_km,raio_maximo_km,cidade_padrao,endereco,loja_lat,loja_lng,loja_endereco_geocodificado",
  );
  const cfg = rCfg.ok ? rCfg.dados?.[0] : null;
  if (!cfg) return resposta(500, { erro: "Configuração da loja indisponível." });
  if (cfg.modo_frete !== "distancia") return resposta(409, { erro: "A loja não usa frete por distância." });

  const cidade = cidadeInformada || cfg.cidade_padrao;
  if (!cidade) return resposta(422, { erro: "Informe a cidade." });
  const endereco = `${rua}, ${bairro}, ${cidade}`;

  // Limite simples contra abuso (protege a cota do Google)
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  if (ip) {
    const desde = new Date(Date.now() - 10 * 60_000).toISOString();
    const r = await banco(
      `cotacoes_frete?select=id&ip=eq.${encodeURIComponent(ip)}&criado_em=gt.${encodeURIComponent(desde)}`,
      { method: "HEAD", headers: { Prefer: "count=exact" } },
    );
    const total = Number(r.headers.get("content-range")?.split("/")[1] ?? 0);
    if (total >= 20) return resposta(429, { erro: "Muitas consultas. Aguarde alguns minutos." });
  }

  let km: number;
  let formatado: string;
  try {
    if (Deno.env.get("MAPS_FAKE") === "1") {
      km = kmFalso(endereco);
      formatado = endereco;
    } else {
      const chave = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (!chave) return resposta(503, { erro: "Cálculo de frete ainda não configurado." });

      // Origem: endereço da loja, geocodificado uma vez e guardado
      let origem: Ponto | null =
        cfg.loja_lat != null && cfg.loja_endereco_geocodificado === cfg.endereco
          ? { lat: cfg.loja_lat, lng: cfg.loja_lng, formatado: cfg.endereco }
          : null;
      if (!origem) {
        origem = await geocodificar(cfg.endereco, chave);
        if (!origem) return resposta(500, { erro: "Não conseguimos localizar o endereço da loja. Confira em Painel > Loja." });
        await banco("configuracoes?id=eq.1", {
          method: "PATCH",
          body: JSON.stringify({ loja_lat: origem.lat, loja_lng: origem.lng, loja_endereco_geocodificado: cfg.endereco }),
        });
      }

      const destino = await geocodificar(endereco, chave);
      if (!destino) {
        return resposta(422, { erro: "Não encontramos esse endereço. Confira a rua, o número e o bairro." });
      }
      km = Math.ceil((await distanciaMetros(origem, destino, chave)) / 100) / 10;
      formatado = destino.formatado;
    }
  } catch (e) {
    console.error("[cotar-frete]", e);
    return resposta(502, { erro: "Não foi possível calcular a entrega agora. Tente de novo ou chame no WhatsApp." });
  }

  const raio = Number(cfg.raio_maximo_km);
  if (km > raio) {
    return resposta(422, {
      erro: `Esse endereço fica a ${km.toFixed(1).replace(".", ",")} km. Entregamos até ${raio.toFixed(1).replace(".", ",")} km.`,
      km,
    });
  }

  const taxa = cfg.taxa_base + Math.round(km * cfg.taxa_por_km);
  const rCot = await banco("cotacoes_frete?select=id,km,taxa,expira_em", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ endereco: normalizar(endereco), endereco_formatado: formatado, km, taxa, ip }),
  });
  const cot = rCot.ok ? rCot.dados?.[0] : null;
  if (!cot) return resposta(500, { erro: "Não foi possível salvar a cotação." });

  return resposta(200, { ...cot, km: Number(cot.km), endereco, endereco_formatado: formatado });
});
