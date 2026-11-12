import type { Categoria, Configuracoes, Produto, RegiaoEntrega } from "./tipos";

/**
 * Dados de exemplo da Adega011.
 * Fonte única para: modo demonstração (sem Supabase), `npm run seed`
 * e o arquivo gerado `supabase/seed.sql`.
 * Os valores entre colchetes do briefing (WhatsApp, endereço, horário,
 * pedido mínimo, regiões) são placeholders: edite aqui ou pelo painel /admin.
 */

export const CONFIG_EXEMPLO: Configuracoes = {
  nome: "Adega011",
  slogan: "São Paulo no copo",
  whatsapp: "5511941522867",
  endereco: "Travessa Sebastião I de Camargo, 72 · Jardim Galetto, Itatiba - SP",
  instagram: "_adega.011",
  horarios: {
    "0": [{ abre: "10:00", fecha: "17:00" }],
    "1": [{ abre: "14:00", fecha: "21:00" }],
    "2": [{ abre: "14:00", fecha: "21:00" }],
    "3": [{ abre: "14:00", fecha: "21:00" }],
    "4": [{ abre: "14:00", fecha: "21:00" }],
    "5": [{ abre: "10:00", fecha: "00:00" }],
    "6": [{ abre: "10:00", fecha: "00:00" }],
  },
  status_manual: "auto",
  pedido_minimo: 3000,
  aceita_entrega: true,
  aceita_retirada: true,
  pagamentos: ["pix", "cartao", "dinheiro"],
  chave_pix: "",
  tempo_entrega: "30–50 min",
  banner_titulo: "São Paulo no copo",
  banner_texto: "Vinho, destilado, cerveja gelada e combo pronto pro rolê. Pede aqui, chega aí.",
  banner_botao_texto: "Ver combos",
  banner_botao_link: "#combos",
  banner_imagem_url: null,
  // No modo demonstração (sem Supabase) o frete por km não roda; usamos regiões.
  modo_frete: "regioes",
  taxa_base: 200,
  taxa_por_km: 150,
  raio_maximo_km: 15,
  cidade_padrao: "Itatiba - SP",
};

const id = (n: number, prefixo: string) =>
  `${prefixo}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const CATEGORIAS_EXEMPLO: Categoria[] = [
  { id: id(1, "c0000000"), nome: "Combos", slug: "combos", ordem: 0, ativa: true },
  { id: id(2, "c0000000"), nome: "Vinhos", slug: "vinhos", ordem: 1, ativa: true },
  { id: id(3, "c0000000"), nome: "Destilados", slug: "destilados", ordem: 2, ativa: true },
  { id: id(4, "c0000000"), nome: "Cervejas", slug: "cervejas", ordem: 3, ativa: true },
];

const [combos, vinhos, destilados, cervejas] = CATEGORIAS_EXEMPLO.map((c) => c.id);

const p = (
  n: number,
  categoria_id: string,
  nome: string,
  descricao: string,
  preco: number,
  foto: string,
  extra: Partial<Produto> = {},
): Produto => ({
  id: id(n, "a0000000"),
  categoria_id,
  nome,
  descricao,
  preco,
  foto_url: `/produtos/${foto}.svg`,
  destaque: false,
  disponivel: true,
  ativo: true,
  ordem: n,
  controla_estoque: false,
  estoque: 0,
  grupos: [],
  ...extra,
});

export const PRODUTOS_EXEMPLO: Produto[] = [
  p(1, combos, "Combo Gin Tônica", "Gin London Dry 750 ml + 4 tônicas 350 ml + gelo 2 kg. É só montar o copo.", 14990, "combo-gin", {
    destaque: true,
    composicao: [
      { nome: "Gin London Dry 750 ml", foto_url: "/produtos/gin.svg", quantidade: 1 },
      { nome: "Tônica 350 ml", foto_url: null, quantidade: 4 },
      { nome: "Gelo 2 kg", foto_url: null, quantidade: 1 },
    ],
  }),
  p(11, combos, "Copão de Askov", "Copão de 700 ml com Askov e gelo. Quer turbinar? Escolhe o energético.", 1000, "combo-vodka", {
    ordem: 0,
    destaque: true,
    grupos: [
      {
        id: id(1, "b0000000"),
        produto_id: id(11, "a0000000"),
        nome: "Energético",
        minimo: 0,
        maximo: 1,
        ordem: 0,
        opcoes: [
          { id: id(1, "d0000000"), grupo_id: id(1, "b0000000"), nome: "Baly", preco: 300, disponivel: true, ordem: 0, foto_url: null },
          { id: id(2, "d0000000"), grupo_id: id(1, "b0000000"), nome: "Red Bull", preco: 700, disponivel: true, ordem: 1, foto_url: "/produtos/cerveja-lata.svg" },
        ],
      },
    ],
  }),
  p(2, combos, "Combo Vodka + Energético", "Vodka 1 L + 4 energéticos 473 ml + gelo 2 kg. Pra virar a noite.", 12990, "combo-vodka"),
  p(3, vinhos, "Tinto Malbec 750 ml", "Argentino, encorpado, com notas de ameixa e baunilha. Vai bem com carne e papo longo.", 6990, "vinho-tinto", { destaque: true }),
  p(4, vinhos, "Branco Sauvignon Blanc 750 ml", "Chileno, fresco e cítrico. Gelado é outra coisa.", 5490, "vinho-branco"),
  p(5, vinhos, "Espumante Brut Rosé 750 ml", "Serra Gaúcha, borbulha fina e fruta vermelha. Pra brindar qualquer coisa.", 7990, "espumante", { disponivel: false }),
  p(6, destilados, "Gin London Dry 750 ml", "Seco, cítrico e com zimbro marcado. Base perfeita pro seu drink.", 11990, "gin", { destaque: true }),
  p(7, destilados, "Vodka Premium 1 L", "Destilada cinco vezes, lisa e neutra. Combina com tudo.", 8990, "vodka"),
  p(8, destilados, "Whisky 12 anos 1 L", "Blended escocês, notas de mel, malte e um defumado leve.", 18990, "whisky"),
  p(9, cervejas, "IPA 473 ml", "Lata de IPA artesanal paulistana: amarga na medida, aroma de maracujá.", 1490, "cerveja-lata"),
  p(10, cervejas, "Pilsen 350 ml · pack 12", "Doze latas de pilsen trincando. O clássico que não falha.", 5490, "cerveja-pack", { destaque: true }),
];

export const REGIOES_EXEMPLO: RegiaoEntrega[] = [
  { id: id(1, "e0000000"), nome: "Região A · até 3 km", taxa: 500, ordem: 0, ativa: true },
  { id: id(2, "e0000000"), nome: "Região B · 3 a 6 km", taxa: 800, ordem: 1, ativa: true },
  { id: id(3, "e0000000"), nome: "Região C · 6 a 10 km", taxa: 1200, ordem: 2, ativa: true },
];
