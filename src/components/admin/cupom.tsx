import type { ItemPedido } from "@/lib/tipos";
import { NOMES_PAGAMENTO, type FormaPagamento } from "@/lib/tipos";
import { formatarPreco } from "@/lib/utils";

export interface DadosCupom {
  numero: number;
  criado_em: string;
  itens: ItemPedido[];
  subtotal: number;
  desconto: number;
  total: number;
  pagamento: FormaPagamento;
  valor_recebido?: number | null;
  troco?: number;
  cliente?: string;
}

const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

/**
 * Cupom não fiscal, pensado para impressora térmica de 80 mm
 * (também funciona em impressora comum). Só aparece na impressão
 * dentro de `.area-cupom` — veja globals.css.
 */
export function Cupom({ dados, loja }: { dados: DadosCupom; loja: { nome: string; endereco: string; whatsapp: string } }) {
  const linha = "-".repeat(32);
  return (
    <div className="cupom font-mono text-[12px] leading-snug text-black">
      <p className="text-center text-[15px] font-bold uppercase">{loja.nome}</p>
      {loja.endereco && <p className="text-center">{loja.endereco}</p>}
      {loja.whatsapp && <p className="text-center">WhatsApp {loja.whatsapp.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3")}</p>}
      <p className="text-center">{linha}</p>
      <p>CUPOM NÃO FISCAL · Venda #{dados.numero}</p>
      <p>{fmt.format(new Date(dados.criado_em))}</p>
      {dados.cliente && dados.cliente !== "Balcão" && <p>Cliente: {dados.cliente}</p>}
      <p className="text-center">{linha}</p>
      {dados.itens.map((it, i) => (
        <div key={i} className="mb-1">
          <p>
            {it.quantidade}x {it.nome}
          </p>
          {it.opcoes?.map((o, j) => (
            <p key={j} className="pl-3">
              + {o.nome}
              {o.preco ? ` ${formatarPreco(o.preco)}` : ""}
            </p>
          ))}
          <p className="flex justify-between">
            <span>{formatarPreco(it.preco)} un</span>
            <span>{formatarPreco(it.preco * it.quantidade)}</span>
          </p>
        </div>
      ))}
      <p className="text-center">{linha}</p>
      <p className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatarPreco(dados.subtotal)}</span>
      </p>
      {dados.desconto > 0 && (
        <p className="flex justify-between">
          <span>Desconto</span>
          <span>-{formatarPreco(dados.desconto)}</span>
        </p>
      )}
      <p className="flex justify-between text-[14px] font-bold">
        <span>TOTAL</span>
        <span>{formatarPreco(dados.total)}</span>
      </p>
      <p className="flex justify-between">
        <span>Pagamento</span>
        <span>{dados.pagamento === "cartao" ? "Cartão" : NOMES_PAGAMENTO[dados.pagamento]}</span>
      </p>
      {dados.pagamento === "dinheiro" && dados.valor_recebido != null && (
        <>
          <p className="flex justify-between">
            <span>Recebido</span>
            <span>{formatarPreco(dados.valor_recebido)}</span>
          </p>
          <p className="flex justify-between font-bold">
            <span>Troco</span>
            <span>{formatarPreco(dados.troco ?? 0)}</span>
          </p>
        </>
      )}
      <p className="text-center">{linha}</p>
      <p className="text-center">Valeu pela preferência!</p>
      <p className="text-center">Beba com moderação · Proibida a venda para menores de 18 anos</p>
    </div>
  );
}
