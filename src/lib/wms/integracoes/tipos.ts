/**
 * Contrato interno do adaptador de ERP. Os nomes aqui são do WMS e NÃO
 * representam endpoints da Olist. Cada implementação declara as capacidades
 * que tem; operação não suportada lança ErroCapacidade (nunca sucesso vazio).
 */

export type Capacidade =
  | "listar_produtos"
  | "listar_depositos"
  | "listar_pedidos"
  | "obter_pedido"
  | "obter_ordem_compra"
  | "consultar_estoque"
  | "lancar_estoque"
  | "verificar_lancamento"
  | "etiquetas_expedicao";

export class ErroCapacidade extends Error {
  constructor(
    public capacidade: Capacidade,
    public motivo: string,
  ) {
    super(`Capacidade indisponível: ${capacidade} (${motivo})`);
    this.name = "ErroCapacidade";
  }
}

export type TipoErroErp = "transitorio" | "permanente" | "desconhecido" | "autorizacao" | "limite";

export class ErroErp extends Error {
  constructor(
    public tipo: TipoErroErp,
    mensagem: string,
    public http?: number,
    public retryAfterS?: number,
    public codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroErp";
  }
}

export type ContextoErp = { connectionId: string; accessToken: string };

export type Pagina<T> = { itens: T[]; proximoOffset: number | null };

export type ProdutoErp = {
  external_id: string;
  sku: string;
  description: string;
  gtin: string | null;
  unit: string | null;
  status: "active" | "inactive";
  external_version: string | null;
};

export type DepositoErp = { external_id: string; name: string; raw: Record<string, unknown> };

export type PedidoResumoErp = { external_id: string; erp_status: string | null };

export type PedidoErp = {
  external_id: string;
  number: string;
  /** Versão monotônica. Sem campo de atualização documentado no detalhe V3, usa-se o instante da consulta. */
  external_version: string;
  erp_status: string;
  deposit_external_id: string | null;
  customer_name: string;
  fiscal_status: "pending" | "released" | "cancelled";
  ship_by: string | null;
  items: { external_item_id: string | null; product_external_id: string; quantity: number }[];
};

export type OrdemCompraErp = {
  external_id: string;
  number: string;
  supplier_name: string;
  deposit_external_id: string | null;
  items: { product_external_id: string; quantity: number }[];
};

export type EstoqueErp = { product_external_id: string; depositos: { external_id: string; saldo: number }[] };

/** Lançamento documentado de estoque (uma linha por produto/depósito). */
export type LancamentoEstoque = {
  product_external_id: string;
  deposit_external_id: string;
  tipo: "E" | "S";
  quantidade: number;
  /** Texto de referência que permite localizar o lançamento (ID do movimento do WMS). */
  observacoes: string;
  /** Custo unitário exigido pelo contrato V3. O WMS não decide custo: sem política definida fica null. */
  precoUnitario: number | null;
};

export type InfoLimite = { limite?: number; restante?: number; resetS?: number };

export interface ErpAdapter {
  readonly nome: "mock" | "olist_v3";
  capacidades(): ReadonlySet<Capacidade>;
  listarProdutos(ctx: ContextoErp, offset: number): Promise<Pagina<ProdutoErp>>;
  listarDepositos(ctx: ContextoErp): Promise<DepositoErp[]>;
  listarPedidos(ctx: ContextoErp, filtro: { atualizadoDesde?: string; offset: number }): Promise<Pagina<PedidoResumoErp>>;
  obterPedido(ctx: ContextoErp, externalId: string): Promise<PedidoErp>;
  obterOrdemCompra(ctx: ContextoErp, externalId: string): Promise<OrdemCompraErp>;
  consultarEstoque(ctx: ContextoErp, productExternalId: string): Promise<EstoqueErp>;
  lancarEstoque(ctx: ContextoErp, l: LancamentoEstoque): Promise<{ external_ref: string }>;
  /** Confirma se um lançamento já foi aplicado (retomada após timeout/crash). */
  verificarLancamento(ctx: ContextoErp, l: LancamentoEstoque): Promise<{ aplicado: boolean; external_ref?: string }>;
  /** Última informação de limite recebida (cabeçalhos X-RateLimit-*). */
  ultimoLimite?(): InfoLimite | undefined;
}

export function exigirCapacidade(a: ErpAdapter, c: Capacidade): void {
  if (!a.capacidades().has(c)) throw new ErroCapacidade(c, "não suportada por este adaptador/contrato validado");
}
