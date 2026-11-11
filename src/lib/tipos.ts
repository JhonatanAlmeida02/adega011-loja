export type FormaPagamento = "pix" | "cartao" | "dinheiro";

export const NOMES_ORIGEM = { site: "Site", balcao: "Balcão" } as const;

export const NOMES_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "Pix",
  cartao: "Cartão na entrega",
  dinheiro: "Dinheiro",
};

/** Faixa de funcionamento. Se `fecha` <= `abre`, a faixa passa da meia-noite. */
export interface FaixaHorario {
  abre: string; // "16:00"
  fecha: string; // "02:00"
}

/** Chave = dia da semana (0 = domingo ... 6 = sábado). */
export type Horarios = Record<string, FaixaHorario[]>;

export type StatusManual = "auto" | "aberta" | "fechada";

export interface Configuracoes {
  nome: string;
  slogan: string;
  whatsapp: string; // somente dígitos, com DDI: 5511999999999
  endereco: string;
  instagram: string;
  horarios: Horarios;
  status_manual: StatusManual;
  pedido_minimo: number; // centavos
  aceita_entrega: boolean;
  aceita_retirada: boolean;
  pagamentos: FormaPagamento[];
  chave_pix: string;
  tempo_entrega: string;
  banner_titulo: string;
  banner_texto: string;
  banner_botao_texto: string;
  banner_botao_link: string;
  banner_imagem_url: string | null;
  /** 'regioes': taxa fixa por região · 'distancia': taxa_base + taxa_por_km × km */
  modo_frete: "regioes" | "distancia";
  taxa_base: number; // centavos
  taxa_por_km: number; // centavos
  raio_maximo_km: number;
  cidade_padrao: string;
}

export interface Categoria {
  id: string;
  nome: string;
  slug: string;
  ordem: number;
  ativa: boolean;
}

export interface Opcao {
  id: string;
  grupo_id: string;
  nome: string;
  preco: number; // centavos (acréscimo)
  disponivel: boolean;
  ordem: number;
}

/** Grupo de adicionais de um produto (ex.: "Energético", escolha até 1). */
export interface GrupoOpcoes {
  id: string;
  produto_id: string;
  nome: string;
  minimo: number;
  maximo: number;
  ordem: number;
  opcoes: Opcao[];
}

export interface Produto {
  id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string;
  preco: number; // centavos
  foto_url: string | null;
  destaque: boolean;
  disponivel: boolean;
  ativo: boolean;
  ordem: number;
  controla_estoque: boolean;
  estoque: number;
  grupos?: GrupoOpcoes[];
}

/** Pode ser vendido agora? (marcado como disponível e com estoque, se controla) */
export function produtoDisponivel(p: Pick<Produto, "disponivel" | "ativo" | "controla_estoque" | "estoque">): boolean {
  return p.disponivel && p.ativo && (!p.controla_estoque || p.estoque > 0);
}

export interface RegiaoEntrega {
  id: string;
  nome: string;
  taxa: number; // centavos
  ordem: number;
  ativa: boolean;
}

export type StatusPedido = "novo" | "confirmado" | "em_entrega" | "concluido" | "cancelado";

export const NOMES_STATUS: Record<StatusPedido, string> = {
  novo: "Novo",
  confirmado: "Confirmado",
  em_entrega: "Saiu para entrega",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export interface ItemPedido {
  produto_id: string;
  nome: string;
  preco: number; // unitário já com adicionais
  preco_base?: number;
  quantidade: number;
  opcoes?: { id?: string; grupo?: string; nome: string; preco: number }[];
}

export interface Pedido {
  id: string;
  numero: number;
  criado_em: string;
  status: StatusPedido;
  cliente_nome: string;
  cliente_telefone: string;
  tipo: "entrega" | "retirada" | "balcao";
  origem: "site" | "balcao";
  desconto: number;
  valor_recebido: number | null;
  distancia_km: number | null;
  caixa_id: string | null;
  regiao_nome: string | null;
  endereco: string | null;
  pagamento: FormaPagamento;
  troco_para: number | null;
  observacoes: string | null;
  itens: ItemPedido[];
  subtotal: number;
  taxa: number;
  total: number;
}

export interface DadosLoja {
  config: Configuracoes;
  categorias: Categoria[];
  produtos: Produto[];
  regioes: RegiaoEntrega[];
  /** true quando o Supabase não está configurado e usamos os dados de exemplo. */
  modoDemo: boolean;
  erro?: string;
}
