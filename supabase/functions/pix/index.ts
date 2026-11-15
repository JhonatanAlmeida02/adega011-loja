// Edge Function "pix" (Supabase / Deno): Pix automático pelo Mercado Pago.
//
// Rotas (verify_jwt = false; quem decide o que vale é o banco e o Mercado Pago):
//   GET  /pix               → { configurado } (o painel mostra se as credenciais estão salvas)
//   POST /pix               { pedido_id } → cria a cobrança Pix do pedido (valor do BANCO)
//   POST /pix/webhook       aviso do Mercado Pago (assinatura x-signature conferida)
//   POST /pix/verificar     { pedido_id } → a tela do cliente pede para conferir agora
//   POST /pix/reconciliar   agendado: confere Pix vencidos que ficaram sem aviso
//   POST /pix/simular       { pedido_id, status } → SÓ com MP_FAKE=1 (testes)
//
// Regra de ouro: nada vira "pago" por causa do que chega no aviso. O aviso só diz
// "olhe o pagamento X"; a função consulta o pagamento no Mercado Pago com o token
// da loja e o banco (public.pix_aplicar) confere referência, valor e moeda.
//
// Segredos (Supabase > Edge Functions > Secrets):
//   MP_ACCESS_TOKEN     token de produção (ou de teste) da aplicação no Mercado Pago
//   MP_WEBHOOK_SECRET   "assinatura secreta" dos Webhooks da aplicação
//   MP_EMAIL_DOMINIO    (opcional) domínio do e-mail do pagador; padrão adega011.com.br
//   MP_FAKE=1           (só testes) não chama o Mercado Pago

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MP = "https://api.mercadopago.com";
const FAKE = Deno.env.get("MP_FAKE") === "1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PNG 1x1 (só para o modo de teste)
const PNG_FAKE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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

/** Chama uma função do banco (RPC) com a chave de serviço. */
async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<{ ok: true; dados: T } | { ok: false; status: number; mensagem: string; codigo?: string }> {
  const chave = chaveDeServico();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: chave,
      ...(chave.startsWith("eyJ") ? { Authorization: `Bearer ${chave}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    console.error("[pix] banco", nome, r.status, texto.slice(0, 300));
    return { ok: false, status: r.status, mensagem: dados?.message ?? "Erro no banco.", codigo: dados?.code };
  }
  return { ok: true, dados: dados as T };
}

/** Lê um pagamento no Mercado Pago (fonte da verdade). */
async function lerPagamento(id: string): Promise<{ status: string; referencia: string | null; valor: number; moeda: string } | null> {
  if (!/^[0-9]{1,20}$/.test(id)) return null;
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) return null;
  const r = await fetch(`${MP}/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) {
    console.error("[pix] MP leitura", id, r.status, (await r.text()).slice(0, 200));
    return null;
  }
  const p = await r.json();
  return {
    status: String(p.status ?? ""),
    referencia: typeof p.external_reference === "string" ? p.external_reference : null,
    valor: Math.round(Number(p.transaction_amount) * 100),
    moeda: String(p.currency_id ?? ""),
  };
}

/** Consulta o Mercado Pago e aplica no banco. */
async function conferir(idExterno: string): Promise<string> {
  const p = await lerPagamento(idExterno);
  if (!p) return "sem-leitura";
  if (!p.referencia || !UUID.test(p.referencia)) return "sem-referencia";
  const r = await rpc<string>("pix_aplicar", {
    p_id_externo: idExterno, p_referencia: p.referencia, p_status_mp: p.status, p_valor: p.valor, p_moeda: p.moeda,
  });
  return r.ok ? r.dados : "erro";
}

/** Confere a assinatura x-signature do Webhook (HMAC-SHA256 do "manifest"). */
async function assinaturaValida(req: Request, dataId: string): Promise<boolean | null> {
  const segredo = Deno.env.get("MP_WEBHOOK_SECRET");
  const cabecalho = req.headers.get("x-signature");
  if (!segredo || !cabecalho) return null; // sem como conferir: só vale a consulta ao MP
  const partes = Object.fromEntries(cabecalho.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;
  const requestId = req.headers.get("x-request-id");
  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifest)));
  const calculado = Array.from(assinatura, (b) => b.toString(16).padStart(2, "0")).join("");
  // Comparação em tempo constante
  if (calculado.length !== v1.length) return false;
  let dif = 0;
  for (let i = 0; i < calculado.length; i++) dif |= calculado.charCodeAt(i) ^ v1.charCodeAt(i);
  return dif === 0;
}

/** Data de vencimento no formato do Mercado Pago, no horário de São Paulo. */
function vencimento(minutos: number): { mp: string; iso: string } {
  const quando = new Date(Date.now() + minutos * 60_000);
  const sp = new Date(quando.getTime() - 3 * 3600_000).toISOString().replace("Z", "-03:00");
  return { mp: sp, iso: quando.toISOString() };
}

async function criarPix(pedidoId: string) {
  const prep = await rpc<{ existente?: { id_externo: string; status: string }; pedido?: { numero: number; total: number; cliente_nome: string } }>(
    "pix_preparar", { p_pedido: pedidoId },
  );
  if (!prep.ok) {
    if (prep.codigo === "P0001") return resposta(422, { erro: prep.mensagem });
    return resposta(500, { erro: "Não foi possível gerar o Pix agora." });
  }
  if (prep.dados.existente) return resposta(200, { ok: true });
  const pedido = prep.dados.pedido!;
  const venc = vencimento(30);

  let idExterno: string;
  let qr: string;
  let qr64: string;
  if (FAKE) {
    idExterno = `fake-${pedidoId}`;
    qr = `00020126PIXTESTE${pedido.numero}5204000053039865802BR`;
    qr64 = PNG_FAKE;
  } else {
    const token = Deno.env.get("MP_ACCESS_TOKEN");
    if (!token) return resposta(503, { erro: "Pix automático ainda não configurado." });
    const dominio = Deno.env.get("MP_EMAIL_DOMINIO") || "adega011.com.br";
    const nome = pedido.cliente_nome.trim().split(/\s+/);
    const r = await fetch(`${MP}/v1/payments`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Mesmo pedido = mesma cobrança, mesmo se a tela chamar duas vezes
        "X-Idempotency-Key": `pix-${pedidoId}`,
      },
      body: JSON.stringify({
        transaction_amount: pedido.total / 100,
        description: `Pedido #${pedido.numero}`,
        payment_method_id: "pix",
        date_of_expiration: venc.mp,
        external_reference: pedidoId,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/pix/webhook`,
        payer: { email: `pedido${pedido.numero}@${dominio}`, first_name: nome[0] ?? "Cliente", last_name: nome.slice(1).join(" ") || "Adega" },
      }),
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok || !corpo) {
      console.error("[pix] MP criação", r.status, JSON.stringify(corpo).slice(0, 300));
      return resposta(502, { erro: "Não foi possível gerar o Pix agora. Escolha outra forma de pagamento ou chame no WhatsApp." });
    }
    // Confere o que o MP devolveu antes de mostrar ao cliente
    if (corpo.external_reference !== pedidoId || Math.round(Number(corpo.transaction_amount) * 100) !== pedido.total) {
      console.error("[pix] MP devolveu cobrança diferente", corpo.id);
      return resposta(502, { erro: "Não foi possível gerar o Pix agora." });
    }
    idExterno = String(corpo.id);
    qr = corpo.point_of_interaction?.transaction_data?.qr_code ?? "";
    qr64 = corpo.point_of_interaction?.transaction_data?.qr_code_base64 ?? "";
    if (!qr) return resposta(502, { erro: "Não foi possível gerar o Pix agora." });
  }

  const reg = await rpc<null>("pix_registrar", {
    p_pedido: pedidoId, p_id_externo: idExterno, p_valor: pedido.total, p_qr_code: qr, p_qr_code_base64: qr64, p_expira_em: venc.iso,
  });
  if (!reg.ok) return resposta(500, { erro: "Não foi possível gerar o Pix agora." });
  return resposta(200, { ok: true });
}

/** id_externo do Pix em aberto de um pedido (leitura com a chave de serviço). */
async function pendenteDoPedido(pedidoId: string): Promise<string | null> {
  const chave = chaveDeServico();
  const r = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/pagamentos?pedido_id=eq.${pedidoId}&status=eq.pendente&select=id_externo&limit=1`,
    { headers: { apikey: chave, ...(chave.startsWith("eyJ") ? { Authorization: `Bearer ${chave}` } : {}) } },
  );
  if (!r.ok) return null;
  const linhas = await r.json();
  return linhas?.[0]?.id_externo ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, "").split("/pix")[1] ?? "";

  if (req.method === "GET" && rota === "") {
    return resposta(200, { configurado: FAKE || !!Deno.env.get("MP_ACCESS_TOKEN") });
  }
  if (req.method !== "POST") return resposta(405, { erro: "Método não permitido." });

  if (rota === "/webhook") {
    const corpo = await req.json().catch(() => ({}));
    const dataId = String(url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? corpo?.data?.id ?? "");
    const tipo = String(url.searchParams.get("type") ?? url.searchParams.get("topic") ?? corpo?.type ?? corpo?.topic ?? "");
    const valida = await assinaturaValida(req, dataId);
    if (valida === false) return resposta(401, { erro: "Assinatura inválida." });
    if (!dataId || (tipo && tipo !== "payment")) return resposta(200, { ok: true, ignorado: true });
    const resultado = FAKE ? "fake" : await conferir(dataId);
    return resposta(200, { ok: true, resultado });
  }

  if (rota === "/reconciliar") {
    if (FAKE) return resposta(200, { ok: true, conferidos: 0 });
    const vencidos = await rpc<{ id_externo: string }[]>("pix_vencidos", { p_limite: 20 });
    if (!vencidos.ok) return resposta(500, { erro: "Erro no banco." });
    const resultados = [];
    for (const v of vencidos.dados) resultados.push(await conferir(v.id_externo));
    return resposta(200, { ok: true, conferidos: resultados.length });
  }

  const corpo = await req.json().catch(() => ({}));
  const pedidoId = String(corpo?.pedido_id ?? "");
  if (!UUID.test(pedidoId)) return resposta(400, { erro: "Pedido inválido." });

  if (rota === "") return criarPix(pedidoId);

  if (rota === "/verificar") {
    if (FAKE) return resposta(200, { ok: true });
    const id = await pendenteDoPedido(pedidoId);
    if (id) await conferir(id);
    return resposta(200, { ok: true });
  }

  if (rota === "/simular" && FAKE) {
    const status = ["approved", "cancelled", "refunded"].includes(corpo?.status) ? corpo.status : "approved";
    const id = `fake-${pedidoId}`;
    const st = await rpc<{ valor: number } | null>("status_pix", { p_pedido: pedidoId });
    if (!st.ok || !st.dados) return resposta(404, { erro: "Sem Pix." });
    const r = await rpc<string>("pix_aplicar", { p_id_externo: id, p_referencia: pedidoId, p_status_mp: status, p_valor: st.dados.valor, p_moeda: "BRL" });
    return resposta(200, { ok: true, resultado: r.ok ? r.dados : "erro" });
  }

  return resposta(404, { erro: "Rota não encontrada." });
});
