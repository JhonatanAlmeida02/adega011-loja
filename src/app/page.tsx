import { carregarLoja } from "@/lib/loja";
import { Banner } from "@/components/loja/banner";
import { Cabecalho } from "@/components/loja/cabecalho";
import { Carrinho } from "@/components/loja/carrinho";
import { Catalogo } from "@/components/loja/catalogo";
import { DadosEstruturados } from "@/components/loja/dados-estruturados";
import { IniciarCarrinho } from "@/components/loja/iniciar-carrinho";
import { Rodape } from "@/components/loja/rodape";
import { VerificacaoIdade } from "@/components/loja/verificacao-idade";

export default async function Home() {
  const loja = await carregarLoja();

  return (
    <>
      <a
        href="#cardapio"
        className="sr-only z-[70] rounded-full bg-amarelo px-5 py-3 font-bold text-preto focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Pular para o cardápio
      </a>
      {loja.modoDemo && (
        <p className="rotulo bg-amarelo px-4 py-2 text-center text-[0.68rem] font-bold text-preto">
          Modo demonstração · configure o Supabase para editar pelo painel
        </p>
      )}
      <DadosEstruturados config={loja.config} />
      <IniciarCarrinho />
      <VerificacaoIdade />
      <Cabecalho config={loja.config} />
      <main className="flex-1">
        <Banner config={loja.config} />
        <Catalogo loja={loja} />
      </main>
      <Rodape config={loja.config} />
      <Carrinho loja={loja} />
    </>
  );
}
