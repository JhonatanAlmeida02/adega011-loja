// Itens da cobrança Pix (usado pela Edge Function "pix"; testado em tests/unit/pix-itens.test.ts).

export type ItemPedido = { produto_id?: string; nome?: string; preco?: number; quantidade?: number; opcoes?: { nome?: string }[] };
export type ItemCobranca = { title: string; unit_price: string; quantity: number; external_code?: string };

/**
 * Itens da cobrança (quantidade e preço unitário de cada produto, mais a taxa de
 * entrega). Só devolve a lista se a soma bater exatamente com o total do pedido;
 * senão devolve null e a cobrança vai sem itens (o valor cobrado é sempre o total).
 */
export function itensDaCobranca(pedido: { total: number; taxa?: number; desconto?: number; itens?: ItemPedido[] }): ItemCobranca[] | null {
  if ((pedido.desconto ?? 0) > 0 || !Array.isArray(pedido.itens) || pedido.itens.length === 0) return null;
  const itens: ItemCobranca[] = pedido.itens.map((i) => {
    const extras = (i.opcoes ?? []).map((o) => o.nome).filter(Boolean).join(", ");
    const titulo = `${i.nome ?? "Produto"}${extras ? ` (${extras})` : ""}`.slice(0, 150);
    return { title: titulo, unit_price: ((i.preco ?? 0) / 100).toFixed(2), quantity: Math.trunc(i.quantidade ?? 0), external_code: i.produto_id };
  });
  if ((pedido.taxa ?? 0) > 0) itens.push({ title: "Taxa de entrega", unit_price: ((pedido.taxa ?? 0) / 100).toFixed(2), quantity: 1, external_code: "entrega" });
  const soma = itens.reduce((s, i) => s + Math.round(Number(i.unit_price) * 100) * i.quantity, 0);
  if (soma !== pedido.total || itens.some((i) => i.quantity < 1 || Number(i.unit_price) <= 0)) return null;
  return itens;
}
