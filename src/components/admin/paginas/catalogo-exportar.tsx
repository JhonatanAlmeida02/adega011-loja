"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { useConfiguracoes } from "@/lib/admin/config";
import { montarSecoes } from "@/lib/catalogo-secoes";
import { contarItens, montarCatalogo, planilhaCatalogo, precosIguais, type ItemCatalogo, type SecaoCatalogo } from "@/lib/catalogo-exportar";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { aplicarSaldos, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco, mascararTelefone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { CabecalhoPagina, Carregando, Cartao, LinhaInterruptor } from "../ui";

const COLUNAS =
  "id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,visibilidade,consumo_proprio,ordem,controla_estoque,estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote,preco_pendente,familia_id,familia_nome,variacao_atributo,variacao_nome";

const semInscricao = () => () => {};
const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/** Catálogo → Exportar catálogo: PDF bonito para clientes e planilha para Excel. */
export function PaginaCatalogoExportar() {
  const { config } = useConfiguracoes();
  const [dados, setDados] = useState<{ produtos: Produto[]; categorias: Categoria[]; skus: Map<string, string> } | null>(null);
  const [escolhidas, setEscolhidas] = useState<Set<string> | null>(null);
  const [soDisponiveis, setSoDisponiveis] = useState(true);
  const [mostrarPrecos, setMostrarPrecos] = useState(true);
  const [mostrarFotos, setMostrarFotos] = useState(true);
  const [titulo, setTitulo] = useState<string | null>(null);
  const [subtitulo, setSubtitulo] = useState("Catálogo de produtos");
  const [imprimindo, setImprimindo] = useState(false);
  const folha = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    void Promise.all([
      sb.from("produtos").select(COLUNAS).order("ordem"),
      sb.from("categorias").select("id,nome,slug,ordem,ativa,pai_id").order("ordem"),
      sb.rpc("saldos_venda"),
      sb.from("produto_importacao").select("produto_id,codigo"),
    ]).then(([p, c, s, i]) => {
      if (!ativo) return;
      const erro = p.error ?? c.error ?? s.error;
      if (erro) return void toast.error(`Não foi possível carregar os produtos: ${erro.message}`);
      setDados({
        produtos: aplicarSaldos((p.data ?? []) as unknown as Produto[], (s.data ?? []) as { produto_id: string; saldo: number }[]),
        categorias: (c.data ?? []) as Categoria[],
        // SKU manual "MANUAL-…" é interno: não vai para a planilha
        skus: new Map(((i.data ?? []) as { produto_id: string; codigo: string }[])
          .filter((x) => x.codigo && !x.codigo.startsWith("MANUAL-")).map((x) => [x.produto_id, x.codigo])),
      });
    });
    return () => { ativo = false; };
  }, []);

  // Só esta tela imprime o catálogo (o PDV imprime o cupom)
  useEffect(() => {
    document.documentElement.classList.add("imprimir-catalogo");
    return () => document.documentElement.classList.remove("imprimir-catalogo");
  }, []);

  const secoes = useMemo(() => (dados ? montarSecoes(dados.categorias, dados.produtos) : []), [dados]);
  const catalogo = useMemo(() => montarCatalogo(secoes, { secoes: escolhidas, soDisponiveis }), [secoes, escolhidas, soDisponiveis]);
  const total = contarItens(catalogo);

  if (!dados || !config) return <Carregando texto="Montando o catálogo…" />;

  const nome = titulo ?? config.nome;
  const alternarSecao = (id: string, marcar: boolean) => {
    const atual = new Set(escolhidas ?? secoes.map((s) => s.id));
    if (marcar) atual.add(id); else atual.delete(id);
    setEscolhidas(atual.size === secoes.length ? null : atual);
  };

  const imprimir = async () => {
    setImprimindo(true);
    try {
      // Espera as fotos carregarem, senão saem em branco no PDF
      const fotos = [...(folha.current?.querySelectorAll("img") ?? [])];
      await Promise.race([
        Promise.all(fotos.map((img) => (img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; })))),
        new Promise((ok) => setTimeout(ok, 15000)),
      ]);
      window.print();
    } finally {
      setImprimindo(false);
    }
  };

  const baixarPlanilha = () => {
    const arquivo = new Blob([planilhaCatalogo(catalogo, dados.skus)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(arquivo);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalogo-${nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Planilha baixada");
  };

  return (
    <>
      <div className="print:hidden">
        <CabecalhoPagina
          titulo="Exportar catálogo"
          descricao="Monte o catálogo dos seus produtos e salve em PDF para mandar aos clientes, ou baixe a planilha para o Excel. Mostra o que aparece na loja."
          acoes={<>
            <Button onClick={imprimir} disabled={!total || imprimindo}><Printer /> {imprimindo ? "Preparando…" : "Salvar PDF / imprimir"}</Button>
            <Button variant="suave" onClick={baixarPlanilha} disabled={!total}><FileSpreadsheet /> Baixar planilha</Button>
          </>}
        />
        <Cartao className="mb-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Título" htmlFor="cat-titulo"><Input id="cat-titulo" maxLength={60} value={nome} onChange={(e) => setTitulo(e.target.value)} /></Campo>
              <Campo label="Subtítulo" htmlFor="cat-subtitulo"><Input id="cat-subtitulo" maxLength={80} value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} /></Campo>
            </div>
            <div className="divide-y divide-borda">
              <LinhaInterruptor rotulo="Só o que está disponível agora" descricao="Deixa de fora o que está esgotado ou pausado" checked={soDisponiveis} onChange={setSoDisponiveis} />
              <LinhaInterruptor rotulo="Mostrar preços" checked={mostrarPrecos} onChange={setMostrarPrecos} />
              <LinhaInterruptor rotulo="Mostrar fotos" checked={mostrarFotos} onChange={setMostrarFotos} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 flex w-full items-center justify-between text-sm font-bold">
              Categorias
              <button type="button" className="cursor-pointer text-xs font-medium text-rosa-texto hover:underline"
                onClick={() => setEscolhidas(escolhidas ? null : new Set())}>{escolhidas ? "Marcar todas" : "Desmarcar todas"}</button>
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {secoes.map((s) => (
                <label key={s.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-rosa" checked={!escolhidas || escolhidas.has(s.id)} onChange={(e) => alternarSecao(s.id, e.target.checked)} />
                  {s.nome}
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-suave" role="status">{total} {total === 1 ? "produto" : "produtos"} no catálogo.</p>
          </fieldset>
        </Cartao>
        <p className="mb-2 text-xs text-suave">Prévia (é assim que sai no PDF). No celular, use “Salvar como PDF” na tela de impressão.</p>
      </div>

      <div ref={folha} className="area-catalogo overflow-hidden rounded-xl bg-white text-neutral-900 shadow-sm ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-0" data-testid="folha-catalogo">
        <FolhaCatalogo catalogo={catalogo} nome={nome} subtitulo={subtitulo} whatsapp={config.whatsapp} instagram={config.instagram}
          endereco={config.endereco} mostrarPrecos={mostrarPrecos} mostrarFotos={mostrarFotos} />
      </div>
    </>
  );
}

function FolhaCatalogo({ catalogo, nome, subtitulo, whatsapp, instagram, endereco, mostrarPrecos, mostrarFotos }: {
  catalogo: SecaoCatalogo[]; nome: string; subtitulo: string; whatsapp: string; instagram: string; endereco: string;
  mostrarPrecos: boolean; mostrarFotos: boolean;
}) {
  const site = useSyncExternalStore(semInscricao, () => window.location.host, () => "");
  const tel = whatsapp.replace(/^55/, "");
  return (
    <div className="p-6 sm:p-8 print:p-0">
      <header className="mb-6 flex items-center gap-4 border-b-4 border-[#ff5c8a] pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo-selo-preto.svg" alt="" className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl font-black uppercase leading-none tracking-tight">{nome}</h2>
          {subtitulo && <p className="mt-1 text-sm text-neutral-600">{subtitulo}</p>}
        </div>
        <div className="text-right text-xs leading-relaxed text-neutral-700">
          {tel && <p><strong>WhatsApp:</strong> {mascararTelefone(tel)}</p>}
          {instagram && <p><strong>Instagram:</strong> @{instagram}</p>}
          {site && <p><strong>Peça pelo site:</strong> {site}</p>}
        </div>
      </header>

      {catalogo.length === 0 && <p className="py-12 text-center text-neutral-500">Nenhum produto com essas opções.</p>}

      {catalogo.map((s) => (
        <section key={s.id} className="mb-4" aria-label={s.nome}>
          <h3 className="mb-2 break-after-avoid rounded-md bg-neutral-900 px-3 py-1 text-base font-black uppercase tracking-wide text-white [print-color-adjust:exact]">{s.nome}</h3>
          {s.grupos.map((g, i) => (
            <div key={g.nome ?? i} className="mb-3">
              {g.nome && <h4 className="mb-2 break-after-avoid border-l-4 border-[#ff5c8a] pl-2 text-sm font-bold uppercase text-neutral-700">{g.nome}</h4>}
              <div className={cn("grid gap-2", mostrarFotos ? "grid-cols-2 sm:grid-cols-4 print:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 print:grid-cols-2")}>
                {g.itens.map((item) => <CartaoItem key={item.chave} item={item} mostrarPrecos={mostrarPrecos} mostrarFotos={mostrarFotos} />)}
              </div>
            </div>
          ))}
        </section>
      ))}

      <footer className="mt-6 border-t border-neutral-300 pt-3 text-center text-[11px] text-neutral-500">
        {endereco && <p>{endereco}</p>}
        <p>Preços e disponibilidade de {fmtData.format(new Date())}, sujeitos a alteração. Venda proibida para menores de 18 anos. Beba com moderação.</p>
      </footer>
    </div>
  );
}

function CartaoItem({ item, mostrarPrecos, mostrarFotos }: { item: ItemCatalogo; mostrarPrecos: boolean; mostrarFotos: boolean }) {
  const iguais = precosIguais(item);
  return (
    <article className={cn("flex break-inside-avoid rounded-lg border border-neutral-200 p-2", mostrarFotos ? "flex-col" : "items-start gap-3")} aria-label={item.nome}>
      {mostrarFotos && (
        <div className="mb-1.5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-neutral-50">
          {item.foto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.foto} alt="" loading="eager" className="size-full object-contain" />
            : <span className="text-xs text-neutral-400">sem foto</span>}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug">{item.nome}</p>
        {item.descricao && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-500">{item.descricao}</p>}
        {item.variacoes.length > 0 && (iguais ? (
          <p className="mt-1 text-[11px] leading-snug text-neutral-700">
            <span className="font-semibold">{item.atributo || "Opções"}:</span> {item.variacoes.map((v) => v.nome).join(", ")}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-neutral-700">
            {item.variacoes.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span>{v.nome}{!v.disponivel && <span className="text-neutral-400"> (esgotado)</span>}</span>
                {mostrarPrecos && <span className="whitespace-nowrap font-semibold">{formatarPreco(v.preco)}</span>}
              </li>
            ))}
          </ul>
        ))}
      </div>
      {mostrarPrecos && (iguais || !item.variacoes.length) && (
        <p className={cn("text-base font-black text-[#e0406f] [print-color-adjust:exact]", mostrarFotos ? "mt-1" : "whitespace-nowrap")}>{formatarPreco(item.preco)}</p>
      )}
      {!item.disponivel && <p className="text-[11px] font-semibold uppercase text-neutral-400">Esgotado</p>}
    </article>
  );
}
