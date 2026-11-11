import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { ordenarGrupos } from "./loja-ordenacao";
import { supabaseConfigurado } from "./supabase/config";
import { supabasePublico } from "./supabase/servidor";
import {
  CATEGORIAS_EXEMPLO,
  CONFIG_EXEMPLO,
  PRODUTOS_EXEMPLO,
  REGIOES_EXEMPLO,
} from "./dados-exemplo";
import { aplicarSaldos, type Categoria, type Configuracoes, type DadosLoja, type Produto, type RegiaoEntrega } from "./tipos";

export const TAG_LOJA = "loja";

/**
 * Carrega tudo o que a vitrine precisa (config, categorias, produtos, regiões).
 * Fica em cache e é revalidado na hora quando o admin salva algo (updateTag).
 */
export async function carregarLoja(): Promise<DadosLoja> {
  "use cache";
  cacheTag(TAG_LOJA);

  if (!supabaseConfigurado) {
    cacheLife("max");
    return {
      config: CONFIG_EXEMPLO,
      categorias: CATEGORIAS_EXEMPLO,
      produtos: PRODUTOS_EXEMPLO.map(ordenarGrupos),
      regioes: REGIOES_EXEMPLO,
      modoDemo: true,
    };
  }

  const sb = supabasePublico();
  const [config, categorias, produtos, regioes, saldos] = await Promise.all([
    sb.from("configuracoes").select("*").eq("id", 1).maybeSingle(),
    sb.from("categorias").select("id,nome,slug,ordem,ativa").order("ordem"),
    sb
      .from("produtos")
      .select(
        "id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,ordem,controla_estoque,estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote,preco_pendente,familia_id,familia_nome,variacao_atributo,variacao_nome," +
          "grupos:grupos_opcoes(id,produto_id,nome,minimo,maximo,ordem,opcoes(id,grupo_id,nome,preco,disponivel,ordem))",
      )
      .order("ordem"),
    sb.from("regioes_entrega").select("id,nome,taxa,ordem,ativa").order("ordem"),
    sb.rpc("saldos_venda"),
  ]);

  const erro = config.error ?? categorias.error ?? produtos.error ?? regioes.error ?? saldos.error;
  if (erro || !config.data) {
    console.error("[loja] Falha ao carregar dados do Supabase:", erro?.message ?? "configuração ausente");
    // Mantém por pouco tempo para tentar de novo logo.
    cacheLife("seconds");
    return {
      config: { ...CONFIG_EXEMPLO, ...(config.data ?? {}) },
      categorias: [],
      produtos: [],
      regioes: [],
      modoDemo: false,
      erro: "Não foi possível carregar o cardápio agora.",
    };
  }

  cacheLife("minutes");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, atualizado_em: _a, ...cfg } = config.data as Configuracoes & {
    id: number;
    atualizado_em: string;
  };

  return {
    config: { ...CONFIG_EXEMPLO, ...cfg },
    categorias: (categorias.data ?? []) as Categoria[],
    produtos: aplicarSaldos(((produtos.data ?? []) as unknown as Produto[]).map(ordenarGrupos), saldos.data ?? []),
    regioes: (regioes.data ?? []) as RegiaoEntrega[],
    modoDemo: false,
  };
}
