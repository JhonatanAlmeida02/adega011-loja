"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Download, FileSpreadsheet, Printer, Upload } from "lucide-react";
import { toast } from "sonner";
import { useConfiguracoes } from "@/lib/admin/config";
import { montarSecoes } from "@/lib/catalogo-secoes";
import { contarItens, montarCatalogo, planilhaCatalogo, precosIguais, type ItemCatalogo, type SecaoCatalogo } from "@/lib/catalogo-exportar";
import { gerarFolhaSvg } from "@/lib/catalogo-svg";
import { estiloTexto, familiaCss, linksFontes, normalizarTema, TEMA_PADRAO, type TemaCatalogo } from "@/lib/catalogo-tema";
import { BUCKET_FOTOS } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { aplicarSaldos, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco, mascararTelefone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { CabecalhoPagina, Carregando, Cartao, LinhaInterruptor } from "../ui";

const COLUNAS =
  "id,categoria_id,nome,descricao,preco,foto_url,destaque,disponivel,ativo,visibilidade,consumo_proprio,ordem,controla_estoque,estoque,eh_kit,unidade_estoque,volume_unidade,unidades_pacote,vende_pacote,preco_pendente,familia_id,familia_nome,variacao_atributo,variacao_nome";
const LOGO_PADRAO = "/marca/logo-selo-preto.svg";

const semInscricao = () => () => {};
const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const rodapeTexto = () => `Preços e disponibilidade de ${fmtData.format(new Date())}, sujeitos a alteração. Venda proibida para menores de 18 anos. Beba com moderação.`;

type TemaSalvo = { usar_figma: boolean; tema: unknown; figma_link: string | null };
type Importado = { tema: TemaCatalogo; link: string; encontradas: string[]; faltando: string[]; decoracoes: number };

/** Imagem (foto ou logo) como data:image/jpeg reduzida, para embutir no SVG do Figma. */
async function imagemEmbutida(url: string, tamanho: number, tipo: "image/jpeg" | "image/png"): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const escala = Math.min(1, tamanho / Math.max(img.naturalWidth || tamanho, img.naturalHeight || tamanho));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || tamanho) * escala));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || tamanho) * escala));
    const ctx = canvas.getContext("2d")!;
    if (tipo === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(tipo, 0.82);
  } catch {
    return null;
  }
}

function baixar(conteudo: BlobPart, tipo: string, nomeArquivo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const nomeArquivo = (nome: string) => nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalogo";

/** Catálogo → Exportar catálogo: PDF bonito para clientes, planilha para Excel e design pelo Figma. */
export function PaginaCatalogoExportar() {
  const { config } = useConfiguracoes();
  const [dados, setDados] = useState<{ produtos: Produto[]; categorias: Categoria[]; skus: Map<string, string> } | null>(null);
  const [escolhidas, setEscolhidas] = useState<Set<string> | null>(null);
  const [soDisponiveis, setSoDisponiveis] = useState(true);
  const [mostrarPrecos, setMostrarPrecos] = useState(true);
  const [mostrarFotos, setMostrarFotos] = useState(true);
  const [mostrarDescricao, setMostrarDescricao] = useState(true);
  const [titulo, setTitulo] = useState<string | null>(null);
  const [subtitulo, setSubtitulo] = useState("Catálogo de produtos");
  const [imprimindo, setImprimindo] = useState(false);
  const [temaSalvo, setTemaSalvo] = useState<TemaSalvo | null>(null);
  const [importado, setImportado] = useState<Importado | null>(null);
  const folha = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    void Promise.all([
      sb.from("produtos").select(COLUNAS).order("ordem"),
      sb.from("categorias").select("id,nome,slug,ordem,ativa,pai_id").order("ordem"),
      sb.rpc("saldos_venda"),
      sb.from("produto_importacao").select("produto_id,codigo"),
      sb.from("catalogo_tema").select("usar_figma,tema,figma_link").eq("id", 1).maybeSingle<TemaSalvo>(),
    ]).then(([p, c, s, i, t]) => {
      if (!ativo) return;
      const erro = p.error ?? c.error ?? s.error;
      if (erro) return void toast.error(`Não foi possível carregar os produtos: ${erro.message}`);
      setTemaSalvo(t.data ?? { usar_figma: false, tema: null, figma_link: null });
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
  const temaFigma = useMemo(() => (temaSalvo?.tema ? normalizarTema(temaSalvo.tema) : null), [temaSalvo]);
  const tema = importado?.tema ?? (temaSalvo?.usar_figma && temaFigma ? temaFigma : TEMA_PADRAO);

  // Fontes do design que o site não tem: carrega do Google Fonts
  const links = linksFontes(tema).join("|");
  useEffect(() => {
    const criados = links ? links.split("|").map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.dataset.catalogo = "fonte";
      document.head.appendChild(l);
      return l;
    }) : [];
    return () => criados.forEach((l) => l.remove());
  }, [links]);

  if (!dados || !config || !temaSalvo) return <Carregando texto="Montando o catálogo…" />;

  const nome = titulo ?? config.nome;
  const tel = config.whatsapp.replace(/^55/, "");
  const site = typeof window === "undefined" ? "" : window.location.host;
  const contato = [tel && `WhatsApp: ${mascararTelefone(tel)}`, config.instagram && `Instagram: @${config.instagram}`, site && `Peça pelo site: ${site}`].filter(Boolean) as string[];

  const alternarSecao = (id: string, marcar: boolean) => {
    const atual = new Set(escolhidas ?? secoes.map((s) => s.id));
    if (marcar) atual.add(id); else atual.delete(id);
    setEscolhidas(atual.size === secoes.length ? null : atual);
  };

  const imprimir = async () => {
    setImprimindo(true);
    try {
      // Espera as fotos e as fontes carregarem, senão saem erradas no PDF
      const fotos = [...(folha.current?.querySelectorAll("img") ?? [])];
      await Promise.race([
        Promise.all([
          ...fotos.map((img) => (img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))),
          document.fonts?.ready,
        ]),
        new Promise((ok) => setTimeout(ok, 15000)),
      ]);
      window.print();
    } finally {
      setImprimindo(false);
    }
  };

  const baixarPlanilha = () => {
    baixar(planilhaCatalogo(catalogo, dados.skus), "text/csv;charset=utf-8", `catalogo-${nomeArquivo(nome)}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success("Planilha baixada");
  };

  const exportarFigma = async () => {
    // Só a primeira folha: as fotos dos primeiros itens bastam
    const fotos = [...new Set(catalogo.flatMap((s) => s.grupos.flatMap((g) => g.itens.map((i) => i.foto))).filter(Boolean) as string[])].slice(0, 40);
    const imagens = new Map<string, string>();
    if (mostrarFotos) {
      await Promise.all(fotos.map(async (url) => { const d = await imagemEmbutida(url, 360, "image/jpeg"); if (d) imagens.set(url, d); }));
    }
    const logo = await imagemEmbutida(tema.logo ?? LOGO_PADRAO, 256, "image/png");
    // Elementos adicionados antes no Figma voltam para a folha, para continuar editando
    const decoracoes = (await Promise.all(tema.decoracoes.map(async (d) => {
      const href = await imagemEmbutida(d.imagem, 1600, "image/png");
      return href ? [{ ...d, href }] : [];
    }))).flat();
    const svg = gerarFolhaSvg(catalogo, tema, {
      nome, subtitulo, contato, rodape: rodapeTexto(), mostrarPrecos, mostrarFotos, mostrarDescricao, imagens, logo, decoracoes,
    });
    baixar(svg, "image/svg+xml", `modelo-catalogo-${nomeArquivo(nome)}.svg`);
    toast.success("Modelo baixado: arraste o arquivo para o Figma");
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
              <LinhaInterruptor rotulo="Mostrar descrição" checked={mostrarDescricao} onChange={setMostrarDescricao} />
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

        <DesignFigma temaSalvo={temaSalvo} importado={importado} onImportado={setImportado}
          onSalvo={(t) => { setTemaSalvo(t); setImportado(null); }} onExportar={exportarFigma} podeExportar={total > 0} />

        <p className="mb-2 text-xs text-suave">
          Prévia (é assim que sai no PDF){importado ? " · mostrando o design importado, ainda não salvo" : tema === TEMA_PADRAO ? " · design padrão" : " · design do Figma"}.
          No celular, use “Salvar como PDF” na tela de impressão.
        </p>
      </div>

      <div ref={folha} className="area-catalogo relative isolate overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-0" data-testid="folha-catalogo"
        style={{ backgroundColor: tema.fundo, backgroundImage: tema.fundoImagem ? `url("${tema.fundoImagem}")` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}>
        {tema.decoracoes.length > 0 && (
          // Elementos adicionados no Figma: posição em % da folha A4; no PDF repetem em toda página (globals.css)
          <div aria-hidden className="decoracoes-catalogo pointer-events-none absolute inset-x-0 top-0 z-0 aspect-[794/1123]">
            {tema.decoracoes.map((d, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${d.imagem}-${i}`} src={d.imagem} alt="" className="decoracao-catalogo absolute max-w-none"
                style={{ left: `${d.x}%`, top: `${d.y}%`, width: `${d.largura}%`, height: `${d.altura}%`,
                  "--x": d.x, "--y": d.y, "--l": d.largura, "--a": d.altura } as React.CSSProperties} />
            ))}
          </div>
        )}
        <FolhaCatalogo catalogo={catalogo} tema={tema} nome={nome} subtitulo={subtitulo} contato={contato} endereco={config.endereco}
          mostrarPrecos={mostrarPrecos} mostrarFotos={mostrarFotos} mostrarDescricao={mostrarDescricao} />
      </div>
    </>
  );
}

/** Design pelo Figma: exportar a folha modelo, reimportar e escolher padrão ou Figma. */
function DesignFigma({ temaSalvo, importado, onImportado, onSalvo, onExportar, podeExportar }: {
  temaSalvo: TemaSalvo; importado: Importado | null; onImportado: (i: Importado | null) => void;
  onSalvo: (t: TemaSalvo) => void; onExportar: () => Promise<void>; podeExportar: boolean;
}) {
  const [link, setLink] = useState(temaSalvo.figma_link ?? "");
  const [ocupado, setOcupado] = useState<"exportar" | "importar" | "salvar" | null>(null);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador().functions.invoke("catalogo-figma", { method: "GET" })
      .then(({ data }) => ativo && setConfigurado(!!(data as { configurado?: boolean } | null)?.configurado))
      .catch(() => ativo && setConfigurado(false));
    return () => { ativo = false; };
  }, []);

  const salvar = async (usarFigma: boolean, novo?: Importado) => {
    setOcupado("salvar");
    setErro(null);
    try {
      const { error } = await supabaseNavegador().rpc("salvar_tema_catalogo", {
        p_usar_figma: usarFigma, p_tema: novo ? novo.tema : null, p_figma_link: novo ? novo.link : null,
      });
      if (error) return void setErro(error.message);
      onSalvo({ usar_figma: usarFigma, tema: novo ? novo.tema : temaSalvo.tema, figma_link: novo ? novo.link : temaSalvo.figma_link });
      toast.success(usarFigma ? "O catálogo agora usa o design do Figma" : "O catálogo voltou ao design padrão");
    } finally {
      setOcupado(null);
    }
  };

  const importar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim() || ocupado) return;
    setOcupado("importar");
    setErro(null);
    try {
      const sb = supabaseNavegador();
      const { data, error } = await sb.functions.invoke("catalogo-figma", { body: { link: link.trim() } });
      if (error) {
        const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
        return void setErro(corpo?.erro ?? "Não foi possível ler o Figma agora.");
      }
      type Deco = { caminho: string; x: number; y: number; largura: number; altura: number };
      const r = data as {
        tema: Record<string, unknown>; imagens: { logo?: string; fundo?: string; decoracoes?: Deco[] };
        encontradas: string[]; faltando: string[];
      };
      const publica = (caminho?: string) => (caminho ? sb.storage.from(BUCKET_FOTOS).getPublicUrl(caminho).data.publicUrl : undefined);
      const tema = normalizarTema({
        ...r.tema, logo: publica(r.imagens.logo), fundoImagem: publica(r.imagens.fundo),
        decoracoes: (r.imagens.decoracoes ?? []).map(({ caminho, ...d }) => ({ ...d, imagem: publica(caminho) })),
      });
      onImportado({ tema, link: link.trim(), encontradas: r.encontradas, faltando: r.faltando, decoracoes: tema.decoracoes.length });
      toast.success("Design lido do Figma. Confira a prévia e salve.");
    } finally {
      setOcupado(null);
    }
  };

  const exportar = async () => {
    setOcupado("exportar");
    try { await onExportar(); } finally { setOcupado(null); }
  };

  const temFigma = !!temaSalvo.tema;
  return (
    <Cartao className="mb-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Design do catálogo</h2>
          <p className="text-sm text-suave">Personalize no Figma: exporte uma folha modelo, mude cores, fontes, logo e fundo, e reimporte. O visual dessa folha vale para todas as páginas.</p>
        </div>
        <div className="flex rounded-lg border border-borda p-0.5" role="radiogroup" aria-label="Design do catálogo">
          {([[false, "Design padrão"], [true, "Design do Figma"]] as const).map(([valor, rotulo]) => (
            <button key={rotulo} type="button" role="radio" aria-checked={!importado && temaSalvo.usar_figma === valor}
              disabled={!!ocupado || (valor && !temFigma)} onClick={() => { onImportado(null); void salvar(valor); }}
              className={cn("h-9 cursor-pointer rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                !importado && temaSalvo.usar_figma === valor ? "bg-rosa text-preto" : "text-suave hover:text-texto")}>
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <ol className="grid gap-3 text-sm lg:grid-cols-2">
        <li className="rounded-xl border border-borda bg-superficie-2 p-3">
          <p className="font-bold">1. Exportar para o Figma</p>
          <p className="mt-1 text-suave">Baixa uma folha A4 com seus produtos. Arraste o arquivo para o Figma e edite cores, fontes, tamanhos, logo e fundo. Não renomeie as camadas.</p>
          <Button variant="suave" size="sm" className="mt-2" onClick={exportar} disabled={!podeExportar || !!ocupado}>
            <Download /> {ocupado === "exportar" ? "Gerando…" : "Exportar para o Figma (1 folha)"}
          </Button>
        </li>
        <li className="rounded-xl border border-borda bg-superficie-2 p-3">
          <p className="font-bold">2. Reimportar do Figma</p>
          <p className="mt-1 text-suave">No Figma, clique na folha com o botão direito → Copiar link. Cole aqui:</p>
          <form onSubmit={importar} className="mt-2 flex gap-2">
            <Input aria-label="Link da folha no Figma" placeholder="https://www.figma.com/design/…" value={link} onChange={(e) => setLink(e.target.value)}
              disabled={configurado === false} className="h-8 text-sm" />
            <Button type="submit" size="sm" disabled={!link.trim() || !!ocupado || configurado === false}>
              <Upload /> {ocupado === "importar" ? "Lendo…" : "Importar"}
            </Button>
          </form>
          {configurado === false && (
            <p role="status" className="mt-2 text-xs text-amarelo-texto">
              Falta o token do Figma: no Figma, Settings → Security → Personal access tokens (leitura de arquivos); depois salve como FIGMA_TOKEN em Supabase → Edge Functions → Secrets.
            </p>
          )}
        </li>
      </ol>

      {erro && <p role="alert" className="rounded-lg border border-perigo/40 p-3 text-sm text-perigo">{erro}</p>}

      {importado && (
        <div className="rounded-xl border border-rosa/40 bg-rosa/5 p-3 text-sm" data-testid="design-importado">
          <p className="font-bold">Design importado: a prévia abaixo já está com ele.</p>
          <p className="mt-1 text-suave">
            Li {importado.encontradas.length} de {importado.encontradas.length + importado.faltando.length} camadas
            {importado.faltando.length ? ` (sem: ${importado.faltando.join(", ")}; essas ficam como no padrão)` : ""}.
            {importado.decoracoes > 0 && ` E ${importado.decoracoes === 1 ? "1 elemento novo" : `${importado.decoracoes} elementos novos`} (logo, marca d’água, figuras…), que ${importado.decoracoes === 1 ? "aparece" : "aparecem"} em todas as páginas.`}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void salvar(true, importado)} disabled={!!ocupado}>{ocupado === "salvar" ? "Salvando…" : "Salvar e usar este design"}</Button>
            <Button size="sm" variant="suave" onClick={() => onImportado(null)} disabled={!!ocupado}>Descartar</Button>
          </div>
        </div>
      )}
    </Cartao>
  );
}

function FolhaCatalogo({ catalogo, tema, nome, subtitulo, contato, endereco, mostrarPrecos, mostrarFotos, mostrarDescricao }: {
  catalogo: SecaoCatalogo[]; tema: TemaCatalogo; nome: string; subtitulo: string; contato: string[]; endereco: string;
  mostrarPrecos: boolean; mostrarFotos: boolean; mostrarDescricao: boolean;
}) {
  // Data do rodapé só no navegador (evita diferença com o servidor)
  const rodape = useSyncExternalStore(semInscricao, rodapeTexto, () => "");
  return (
    <div className="relative z-10 p-6 sm:p-8 print:p-0">
      <header className="mb-6 flex items-center gap-4 pb-4" style={{ borderBottom: `4px solid ${tema.destaque}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tema.logo ?? LOGO_PADRAO} alt="" className="size-16 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <h2 className="uppercase leading-none tracking-tight" style={estiloTexto(tema.titulo)}>{nome}</h2>
          {subtitulo && <p className="mt-1" style={estiloTexto(tema.subtitulo)}>{subtitulo}</p>}
        </div>
        <div className="text-right leading-relaxed" style={estiloTexto(tema.contato)}>
          {contato.map((linha) => {
            const [rotulo, ...resto] = linha.split(": ");
            return <p key={linha}><strong>{rotulo}:</strong> {resto.join(": ")}</p>;
          })}
        </div>
      </header>

      {catalogo.length === 0 && <p className="py-12 text-center" style={estiloTexto(tema.rodape)}>Nenhum produto com essas opções.</p>}

      {catalogo.map((s) => (
        <section key={s.id} className="mb-4" aria-label={s.nome}>
          <h3 className="mb-2 break-after-avoid rounded-md px-3 py-1 uppercase tracking-wide"
            style={{ ...estiloTexto(tema.categoria), backgroundColor: tema.categoria.fundo }}>{s.nome}</h3>
          {s.grupos.map((g, i) => (
            <div key={g.nome ?? i} className="mb-3">
              {g.nome && <h4 className="mb-2 break-after-avoid pl-2 uppercase" style={{ ...estiloTexto(tema.subcategoria), borderLeft: `4px solid ${tema.subcategoria.marca}` }}>{g.nome}</h4>}
              <div className={cn("grid gap-2", mostrarFotos ? "grid-cols-2 sm:grid-cols-4 print:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 print:grid-cols-2")}>
                {g.itens.map((item) => <CartaoItem key={item.chave} item={item} tema={tema} mostrarPrecos={mostrarPrecos} mostrarFotos={mostrarFotos} mostrarDescricao={mostrarDescricao} />)}
              </div>
            </div>
          ))}
        </section>
      ))}

      <footer className="mt-6 pt-3 text-center" style={{ ...estiloTexto(tema.rodape), borderTop: `1px solid ${tema.cartao.borda}` }}>
        {endereco && <p>{endereco}</p>}
        <p>{rodape}</p>
      </footer>
    </div>
  );
}

function CartaoItem({ item, tema, mostrarPrecos, mostrarFotos, mostrarDescricao }: {
  item: ItemCatalogo; tema: TemaCatalogo; mostrarPrecos: boolean; mostrarFotos: boolean; mostrarDescricao: boolean;
}) {
  const iguais = precosIguais(item);
  return (
    <article className={cn("flex break-inside-avoid border p-2", mostrarFotos ? "flex-col" : "items-start gap-3")} aria-label={item.nome}
      style={{ backgroundColor: tema.cartao.fundo, borderColor: tema.cartao.borda, borderRadius: tema.cartao.raio }}>
      {mostrarFotos && (
        <div className="mb-1.5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md" style={{ backgroundColor: tema.cartao.fotoFundo }}>
          {item.foto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.foto} alt="" loading="eager" className="size-full object-contain" />
            : <span className="text-xs" style={{ color: tema.descricao.cor }}>sem foto</span>}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="leading-snug" style={estiloTexto(tema.nome)}>{item.nome}</p>
        {mostrarDescricao && item.descricao && <p className="mt-0.5 line-clamp-2 leading-snug" style={estiloTexto(tema.descricao)} data-testid="descricao-produto">{item.descricao}</p>}
        {item.variacoes.length > 0 && (iguais || !mostrarPrecos ? (
          <p className="mt-1 leading-snug" style={estiloTexto(tema.variacoes)}>
            <span className="font-semibold">{item.atributo || "Opções"}:</span> {item.variacoes.map((v) => v.nome).join(", ")}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 leading-snug" style={estiloTexto(tema.variacoes)}>
            {item.variacoes.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span>{v.nome}{!v.disponivel && <span className="opacity-60"> (esgotado)</span>}</span>
                <span className="whitespace-nowrap font-semibold">{formatarPreco(v.preco)}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
      {mostrarPrecos && (iguais || !item.variacoes.length) && (
        <p className={cn("[print-color-adjust:exact]", mostrarFotos ? "mt-1" : "whitespace-nowrap")} style={estiloTexto(tema.preco)}>{formatarPreco(item.preco)}</p>
      )}
      {!item.disponivel && <p className="text-[11px] font-semibold uppercase opacity-60" style={{ fontFamily: familiaCss(tema.descricao.fonte), color: tema.descricao.cor }}>Esgotado</p>}
    </article>
  );
}
