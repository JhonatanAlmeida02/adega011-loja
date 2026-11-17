/**
 * Adaptador da API V3 do ERP Olist, restrito aos contratos conferidos em
 * https://api-docs.erp.olist.com (17/11/2026) e registrados em docs/olist-capabilities.md.
 *
 *  GET  /produtos?limit&offset                 listar produtos
 *  GET  /depositos                             listar depósitos
 *  GET  /pedidos?dataAtualizacao&limit&offset  listar pedidos
 *  GET  /pedidos/{idPedido}                    obter pedido
 *  GET  /ordem-compra/{idOrdemCompra}          obter ordem de compra
 *  GET  /estoque/{idProduto}                   obter estoque do produto
 *  POST /estoque/{idProduto}                   lançar estoque (tipo E/S, depósito, quantidade)
 *
 * Não documentado/validado (e por isso indisponível aqui): chave de idempotência,
 * consulta de um lançamento pelo texto de observação, assinatura de webhook,
 * etiquetas de transportadora. Escrita real só com OLIST_WRITE_ENABLED=true E a
 * conexão com write_enabled (ambos desligados por padrão).
 */
import {
  ErroCapacidade, ErroErp, type Capacidade, type ContextoErp, type DepositoErp, type ErpAdapter, type EstoqueErp,
  type InfoLimite, type LancamentoEstoque, type OrdemCompraErp, type Pagina, type PedidoErp, type PedidoResumoErp, type ProdutoErp,
} from "./tipos";

export const OLIST_V3_BASE_PADRAO = "https://api.tiny.com.br/public-api/v3";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export type OpcoesOlistV3 = {
  baseUrl?: string;
  timeoutMs?: number;
  escritaHabilitada?: boolean;
  /** Valores de `notaFiscal.situacao` que a empresa validou como "autorizada". Vazio = nunca libera automaticamente. */
  situacoesNotaAutorizada?: string[];
  depositoPadraoOrdemCompra?: string | null;
  fetchImpl?: typeof fetch;
};

export class OlistV3Adapter implements ErpAdapter {
  readonly nome = "olist_v3" as const;
  private limite: InfoLimite | undefined;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private opcoes: OpcoesOlistV3 = {}) {
    this.base = (opcoes.baseUrl || OLIST_V3_BASE_PADRAO).replace(/\/+$/, "");
    if (!/^https:\/\//.test(this.base)) throw new Error("OLIST_API_BASE_URL deve usar HTTPS.");
    this.timeoutMs = opcoes.timeoutMs ?? 20_000;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  capacidades(): ReadonlySet<Capacidade> {
    const c = new Set<Capacidade>(["listar_produtos", "listar_depositos", "listar_pedidos", "obter_pedido", "obter_ordem_compra", "consultar_estoque"]);
    if (this.opcoes.escritaHabilitada) c.add("lancar_estoque");
    return c;
  }

  ultimoLimite() {
    return this.limite;
  }

  private async chamar(ctx: ContextoErp, metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<unknown> {
    const url = `${this.base}${caminho}`;
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          Accept: "application/json",
          ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        redirect: "error", // sem seguir redirecionamentos (evita SSRF/vazamento do token)
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // Sem resposta: numa escrita o efeito é DESCONHECIDO; numa leitura, transitório.
      const msg = e instanceof Error ? e.name : "erro de rede";
      throw new ErroErp(metodo === "POST" ? "desconhecido" : "transitorio", `Falha de comunicação (${msg})`, undefined, undefined, "network");
    }
    const n = (h: string) => {
      const v = resp.headers.get(h);
      return v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);
    };
    this.limite = { limite: n("X-RateLimit-Limit"), restante: n("X-RateLimit-Remaining"), resetS: n("X-RateLimit-Reset") };
    const texto = await resp.text();
    let dados: unknown = null;
    if (texto) {
      try {
        dados = JSON.parse(texto);
      } catch {
        dados = null;
      }
    }
    if (resp.ok) return dados;
    const mensagem = txt(obj(dados).mensagem) ?? `HTTP ${resp.status}`;
    if (resp.status === 429) throw new ErroErp("limite", mensagem, 429, n("Retry-After") ?? this.limite.resetS ?? 60, "rate_limited");
    if (resp.status === 401) throw new ErroErp("autorizacao", mensagem, 401, undefined, "unauthorized");
    if (resp.status >= 500) {
      // 5xx numa escrita: o servidor pode ter aplicado; tratar como desconhecido
      throw new ErroErp(metodo === "POST" ? "desconhecido" : "transitorio", mensagem, resp.status, n("Retry-After"));
    }
    throw new ErroErp("permanente", mensagem, resp.status, undefined, resp.status === 403 ? "forbidden" : resp.status === 404 ? "not_found" : "validation");
  }

  async listarProdutos(ctx: ContextoErp, offset: number): Promise<Pagina<ProdutoErp>> {
    const limit = 100;
    const d = obj(await this.chamar(ctx, "GET", `/produtos?limit=${limit}&offset=${offset}`));
    const itens = arr(d.itens).map((x) => {
      const p = obj(x);
      const id = txt(p.id);
      const sku = txt(p.sku);
      if (!id || !sku) throw new ErroErp("permanente", "Resposta de produto fora do contrato (id/sku).", undefined, undefined, "contract_mismatch");
      return {
        external_id: id, sku, description: txt(p.descricao) ?? sku, gtin: txt(p.gtin), unit: txt(p.unidade),
        status: txt(p.situacao) === "A" ? "active" : "inactive", external_version: txt(p.dataAlteracao),
      } satisfies ProdutoErp;
    });
    return { itens, proximoOffset: this.proximo(obj(d.paginacao), offset, itens.length, limit) };
  }

  private proximo(pag: Obj, offset: number, recebidos: number, limit: number): number | null {
    const total = Number(pag.total);
    if (Number.isFinite(total)) return offset + recebidos < total ? offset + recebidos : null;
    return recebidos === limit ? offset + recebidos : null;
  }

  async listarDepositos(ctx: ContextoErp): Promise<DepositoErp[]> {
    const d = await this.chamar(ctx, "GET", "/depositos");
    const lista = Array.isArray(d) ? d : arr(obj(d).itens);
    return lista.map((x) => {
      const p = obj(x);
      const id = txt(p.id);
      if (!id) throw new ErroErp("permanente", "Depósito sem id.", undefined, undefined, "contract_mismatch");
      return { external_id: id, name: txt(p.descricao) ?? id, raw: { tipo: p.tipo, padrao: p.padrao, desconsideraSaldo: p.desconsideraSaldo } };
    });
  }

  async listarPedidos(ctx: ContextoErp, filtro: { atualizadoDesde?: string; offset: number }): Promise<Pagina<PedidoResumoErp>> {
    const limit = 100;
    const q = new URLSearchParams({ limit: String(limit), offset: String(filtro.offset) });
    if (filtro.atualizadoDesde) q.set("dataAtualizacao", filtro.atualizadoDesde);
    const d = obj(await this.chamar(ctx, "GET", `/pedidos?${q}`));
    const itens = arr(d.itens).map((x) => ({ external_id: String(obj(x).id), erp_status: txt(obj(x).situacao) }));
    return { itens, proximoOffset: this.proximo(obj(d.paginacao), filtro.offset, itens.length, limit) };
  }

  async obterPedido(ctx: ContextoErp, externalId: string): Promise<PedidoErp> {
    if (!/^[0-9]{1,20}$/.test(externalId)) throw new ErroErp("permanente", "ID de pedido inválido.", undefined, undefined, "validation");
    const consultadoEm = new Date().toISOString();
    const p = obj(await this.chamar(ctx, "GET", `/pedidos/${externalId}`));
    const situacao = txt(p.situacao);
    if (txt(p.id) === null || situacao === null) {
      throw new ErroErp("permanente", "Resposta de pedido fora do contrato (id/situacao).", undefined, undefined, "contract_mismatch");
    }
    const nota = obj(p.notaFiscal);
    const autorizadas = this.opcoes.situacoesNotaAutorizada ?? [];
    const sitNota = txt(nota.situacao);
    return {
      external_id: String(p.id),
      number: txt(p.numeroPedido) ?? String(p.id),
      external_version: consultadoEm,
      erp_status: situacao,
      deposit_external_id: txt(obj(p.deposito).id),
      customer_name: txt(obj(p.cliente).nome) ?? "",
      fiscal_status: sitNota !== null && autorizadas.includes(sitNota) ? "released" : "pending",
      ship_by: txt(p.dataLimiteDespacho),
      items: arr(p.itens).map((x, i) => {
        const it = obj(x);
        const prod = txt(obj(it.produto).id);
        const qtd = Number(it.quantidade);
        if (!prod || !Number.isFinite(qtd) || qtd <= 0) {
          throw new ErroErp("permanente", "Item de pedido fora do contrato.", undefined, undefined, "contract_mismatch");
        }
        return { external_item_id: `${p.id}:${i + 1}`, product_external_id: prod, quantity: qtd };
      }),
    };
  }

  async obterOrdemCompra(ctx: ContextoErp, externalId: string): Promise<OrdemCompraErp> {
    if (!/^[0-9]{1,20}$/.test(externalId)) throw new ErroErp("permanente", "ID inválido.", undefined, undefined, "validation");
    const o = obj(await this.chamar(ctx, "GET", `/ordem-compra/${externalId}`));
    return {
      external_id: String(o.id ?? externalId),
      number: txt(o.numeroPedido) ?? externalId,
      supplier_name: txt(obj(o.contato).nome) ?? "",
      // A ordem de compra V3 não informa depósito: usa o depósito configurado pela empresa.
      deposit_external_id: this.opcoes.depositoPadraoOrdemCompra ?? null,
      items: arr(o.itens).map((x) => {
        const it = obj(x);
        const prod = txt(obj(it.produto).id);
        const qtd = Number(it.quantidade);
        if (!prod || !Number.isFinite(qtd) || qtd <= 0) throw new ErroErp("permanente", "Item de ordem de compra fora do contrato.", undefined, undefined, "contract_mismatch");
        return { product_external_id: prod, quantity: qtd };
      }),
    };
  }

  async consultarEstoque(ctx: ContextoErp, productExternalId: string): Promise<EstoqueErp> {
    if (!/^[0-9]{1,20}$/.test(productExternalId)) throw new ErroErp("permanente", "ID de produto inválido.", undefined, undefined, "validation");
    const d = obj(await this.chamar(ctx, "GET", `/estoque/${productExternalId}`));
    return {
      product_external_id: productExternalId,
      depositos: arr(d.depositos).map((x) => ({ external_id: String(obj(x).id), saldo: Number(obj(x).saldo) || 0 })),
    };
  }

  async lancarEstoque(ctx: ContextoErp, l: LancamentoEstoque): Promise<{ external_ref: string }> {
    if (!this.opcoes.escritaHabilitada) throw new ErroCapacidade("lancar_estoque", "escrita real desabilitada (OLIST_WRITE_ENABLED)");
    if (!/^[0-9]{1,20}$/.test(l.product_external_id)) throw new ErroErp("permanente", "ID de produto inválido.", undefined, undefined, "validation");
    // precoUnitario é obrigatório no contrato e afeta custo no ERP: sem origem de custo definida, não envia.
    if (l.precoUnitario === null || !Number.isFinite(l.precoUnitario)) {
      throw new ErroCapacidade("lancar_estoque", "precoUnitario obrigatório sem política de custo definida");
    }
    const d = obj(await this.chamar(ctx, "POST", `/estoque/${l.product_external_id}`, {
      deposito: { id: Number(l.deposit_external_id) },
      tipo: l.tipo,
      quantidade: l.quantidade,
      precoUnitario: l.precoUnitario,
      observacoes: l.observacoes,
    }));
    const id = txt(d.idLancamento);
    if (!id) throw new ErroErp("desconhecido", "Resposta sem idLancamento.", 200, undefined, "contract_mismatch");
    return { external_ref: id };
  }

  async verificarLancamento(): Promise<{ aplicado: boolean; external_ref?: string }> {
    throw new ErroCapacidade("verificar_lancamento", "consulta de lançamento por referência não validada na V3");
  }
}
