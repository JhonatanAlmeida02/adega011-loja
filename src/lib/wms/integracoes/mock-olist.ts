/**
 * Simulador do ERP Olist para DESENVOLVIMENTO e TESTES (dados fictícios).
 * Não representa o comportamento real da conta: serve para exercitar o WMS
 * (paginação, falhas, 429, timeout com efeito desconhecido) sem credenciais.
 * Toda tela/registro produzido por ele é marcado como "simulado".
 */
import {
  ErroErp, type Capacidade, type ContextoErp, type DepositoErp, type ErpAdapter, type EstoqueErp, type LancamentoEstoque,
  type OrdemCompraErp, type Pagina, type PedidoErp, type PedidoResumoErp, type ProdutoErp,
} from "./tipos";

export type FalhaSimulada = "timeout" | "timeout_apos_aplicar" | "429" | "500" | "400" | "401";

export type EstadoMock = {
  produtos: ProdutoErp[];
  depositos: DepositoErp[];
  pedidos: Map<string, Omit<PedidoErp, "external_version">>;
  ordensCompra: Map<string, OrdemCompraErp>;
  saldos: Map<string, number>; // `${produto}|${deposito}`
  lancamentos: (LancamentoEstoque & { external_ref: string })[];
  falhas: Map<string, FalhaSimulada[]>; // por operação, consumidas em ordem
  chamadas: string[];
};

let relogio = 0;
const versaoAgora = () => new Date(Date.now() + relogio++).toISOString();

export function estadoMockInicial(): EstadoMock {
  return {
    produtos: [
      { external_id: "9001", sku: "SIM-CERVEJA-269", description: "[SIMULADO] Cerveja lata 269 ml", gtin: "07891234000019", unit: "UN", status: "active", external_version: "2026-11-01T10:00:00Z" },
      { external_id: "9002", sku: "SIM-VODKA-1L", description: "[SIMULADO] Vodka 1 L", gtin: "07891234000026", unit: "UN", status: "active", external_version: "2026-11-01T10:00:00Z" },
      { external_id: "9003", sku: "SIM-GELO-5KG", description: "[SIMULADO] Gelo 5 kg", gtin: null, unit: "PCT", status: "active", external_version: "2026-11-01T10:00:00Z" },
    ],
    depositos: [
      { external_id: "501", name: "[SIMULADO] Depósito principal", raw: { tipo: "P", padrao: true } },
      { external_id: "502", name: "[SIMULADO] Depósito marketplace", raw: { tipo: "E", padrao: false } },
    ],
    pedidos: new Map(),
    ordensCompra: new Map(),
    saldos: new Map(),
    lancamentos: [],
    falhas: new Map(),
    chamadas: [],
  };
}

export class MockOlistAdapter implements ErpAdapter {
  readonly nome = "mock" as const;
  constructor(public estado: EstadoMock = estadoMockInicial()) {}

  capacidades(): ReadonlySet<Capacidade> {
    return new Set<Capacidade>([
      "listar_produtos", "listar_depositos", "listar_pedidos", "obter_pedido", "obter_ordem_compra",
      "consultar_estoque", "lancar_estoque", "verificar_lancamento",
    ]);
  }

  /** Programa falhas para as próximas chamadas de uma operação. */
  falhar(operacao: string, ...falhas: FalhaSimulada[]) {
    this.estado.falhas.set(operacao, [...(this.estado.falhas.get(operacao) ?? []), ...falhas]);
  }

  private async entrada(operacao: string, aplicar?: () => void): Promise<void> {
    this.estado.chamadas.push(operacao);
    const fila = this.estado.falhas.get(operacao);
    const f = fila?.shift();
    if (!f) return;
    switch (f) {
      case "timeout":
        throw new ErroErp("desconhecido", "Tempo esgotado (simulado)", undefined, undefined, "timeout");
      case "timeout_apos_aplicar":
        aplicar?.();
        throw new ErroErp("desconhecido", "Tempo esgotado após envio (simulado)", undefined, undefined, "timeout");
      case "429":
        throw new ErroErp("limite", "Limite de requisições (simulado)", 429, 2, "rate_limited");
      case "500":
        throw new ErroErp("transitorio", "Erro do servidor (simulado)", 500);
      case "400":
        throw new ErroErp("permanente", "Requisição inválida (simulado)", 400, undefined, "validation");
      case "401":
        throw new ErroErp("autorizacao", "Token inválido (simulado)", 401);
    }
  }

  async listarProdutos(_ctx: ContextoErp, offset: number): Promise<Pagina<ProdutoErp>> {
    await this.entrada("listar_produtos");
    const limite = 2;
    const itens = this.estado.produtos.slice(offset, offset + limite);
    return { itens, proximoOffset: offset + limite < this.estado.produtos.length ? offset + limite : null };
  }

  async listarDepositos(): Promise<DepositoErp[]> {
    await this.entrada("listar_depositos");
    return this.estado.depositos;
  }

  async listarPedidos(_ctx: ContextoErp, filtro: { offset: number }): Promise<Pagina<PedidoResumoErp>> {
    await this.entrada("listar_pedidos");
    const todos = [...this.estado.pedidos.values()];
    const itens = todos.slice(filtro.offset, filtro.offset + 50).map((p) => ({ external_id: p.external_id, erp_status: p.erp_status }));
    return { itens, proximoOffset: filtro.offset + 50 < todos.length ? filtro.offset + 50 : null };
  }

  async obterPedido(_ctx: ContextoErp, externalId: string): Promise<PedidoErp> {
    await this.entrada("obter_pedido");
    const p = this.estado.pedidos.get(externalId);
    if (!p) throw new ErroErp("permanente", "Pedido não encontrado (simulado)", 404, undefined, "not_found");
    return { ...structuredClone(p), external_version: versaoAgora() };
  }

  async obterOrdemCompra(_ctx: ContextoErp, externalId: string): Promise<OrdemCompraErp> {
    await this.entrada("obter_ordem_compra");
    const o = this.estado.ordensCompra.get(externalId);
    if (!o) throw new ErroErp("permanente", "Ordem de compra não encontrada (simulado)", 404, undefined, "not_found");
    return structuredClone(o);
  }

  async consultarEstoque(_ctx: ContextoErp, productExternalId: string): Promise<EstoqueErp> {
    await this.entrada("consultar_estoque");
    return {
      product_external_id: productExternalId,
      depositos: this.estado.depositos.map((d) => ({ external_id: d.external_id, saldo: this.estado.saldos.get(`${productExternalId}|${d.external_id}`) ?? 0 })),
    };
  }

  async lancarEstoque(_ctx: ContextoErp, l: LancamentoEstoque): Promise<{ external_ref: string }> {
    const ref = `SIM-LANC-${this.estado.lancamentos.length + 1}`;
    const aplicar = () => {
      this.estado.lancamentos.push({ ...l, external_ref: ref });
      const k = `${l.product_external_id}|${l.deposit_external_id}`;
      this.estado.saldos.set(k, (this.estado.saldos.get(k) ?? 0) + (l.tipo === "E" ? l.quantidade : -l.quantidade));
    };
    await this.entrada("lancar_estoque", aplicar);
    aplicar();
    return { external_ref: ref };
  }

  async verificarLancamento(_ctx: ContextoErp, l: LancamentoEstoque): Promise<{ aplicado: boolean; external_ref?: string }> {
    await this.entrada("verificar_lancamento");
    const achado = this.estado.lancamentos.find((x) => x.observacoes === l.observacoes && x.product_external_id === l.product_external_id);
    return achado ? { aplicado: true, external_ref: achado.external_ref } : { aplicado: false };
  }
}
