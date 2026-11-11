"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Package, Plus, Trash2 } from "lucide-react";
import { Tabs } from "radix-ui";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { removerImagem, useUploadsPendentes } from "@/lib/admin/imagens";
import { revalidarLoja } from "@/app/admin/acoes";
import type { Categoria, Produto } from "@/lib/tipos";
import { centavosParaCampo, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { EditorKit, type ComponenteKit } from "./editor-kit";
import { EditorAdicionais } from "./editor-adicionais";
import { Carregando, UploadImagem } from "./ui";

type Rascunho = Omit<Produto, "preco"> & { preco: string };
interface DadosCadastro { produto: Produto; categorias: Categoria[]; bases: Produto[]; componentes: ComponenteKit[]; variacoes: Produto[] }
interface VariacaoRascunho { id: string; nome: string; preco: string; volume_unidade: number; unidades_pacote: number; ativo: boolean; disponivel: boolean; estoque: number; existente: boolean }

export function CadastroProduto({ produtoId }: { produtoId?: string }) {
  const params = useSearchParams();
  const categoriaInicial = params.get("categoria");
  const [dados, setDados] = useState<DadosCadastro | null>(null);
  const [erro, setErro] = useState("");
  const router = useRouter();

  useEffect(() => {
    let ativo = true;
    const sb = supabaseNavegador();
    Promise.all([
      sb.from("categorias").select("*").order("ordem"),
      sb.from("produtos").select("*").eq("eh_kit", false).eq("controla_estoque", true).order("nome"),
      produtoId ? sb.from("produtos").select("*").eq("id", produtoId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      produtoId ? sb.from("kit_componentes").select("componente_id,quantidade").eq("kit_id", produtoId) : Promise.resolve({ data: [], error: null }),
    ]).then(async ([categorias, bases, produto, componentes]) => {
      if (!ativo) return;
      const falha = categorias.error ?? bases.error ?? produto.error ?? componentes.error;
      if (falha) return setErro(`Não foi possível carregar o cadastro: ${falha.message}`);
      if (produtoId && !produto.data) return setErro("Produto não encontrado.");
      const cats = (categorias.data ?? []) as Categoria[];
      const novo: Produto = {
        id: crypto.randomUUID(), nome: "", descricao: "", preco: 0, foto_url: null,
        categoria_id: cats.find((c) => c.id === categoriaInicial)?.id ?? cats[0]?.id ?? null,
        destaque: false, disponivel: true, ativo: true, ordem: 0, controla_estoque: false,
        estoque: 0, eh_kit: false, unidade_estoque: "un", volume_unidade: 1, unidades_pacote: 1, vende_pacote: false,
      };
      let variacoes: Produto[] = [];
      if (produto.data?.familia_id) {
        const grupo = await sb.from("produtos").select("*").eq("familia_id", produto.data.familia_id).order("ordem").order("nome");
        if (!ativo) return;
        if (grupo.error) return setErro(`Não foi possível carregar as variações: ${grupo.error.message}`);
        variacoes = (grupo.data ?? []) as Produto[];
      }
      setDados({ variacoes, produto: (produto.data as Produto | null) ?? novo, categorias: cats,
        bases: ((bases.data ?? []) as Produto[]).filter((p) => p.id !== produtoId),
        componentes: (componentes.data ?? []) as ComponenteKit[] });
    }).catch(() => { if (ativo) setErro("Sem conexão para carregar o cadastro. Tente novamente."); });
    return () => { ativo = false; };
  }, [produtoId, categoriaInicial]);

  if (erro) return <div className="space-y-4"><p role="alert" className="text-perigo">{erro}</p><Button variant="suave" onClick={() => router.push("/admin/produtos")}>Voltar para produtos</Button></div>;
  if (!dados) return <Carregando texto="Carregando cadastro…" />;
  return <Formulario key={dados.produto.id} dados={dados} existente={!!produtoId} />;
}

function Formulario({ dados, existente }: { dados: DadosCadastro; existente: boolean }) {
  const [f, setF] = useState<Rascunho>({ ...dados.produto, preco: existente && !dados.produto.preco_pendente ? centavosParaCampo(dados.produto.preco) : "", nome: dados.produto.familia_nome || dados.produto.nome });
  const [comVariacoes, setComVariacoes] = useState(!!dados.produto.familia_id);
  const [atributo, setAtributo] = useState(dados.produto.variacao_atributo ?? "Sabor");
  const [variacoes, setVariacoes] = useState<VariacaoRascunho[]>(dados.variacoes.map((p) => ({
    id: p.id, nome: p.variacao_nome ?? "", preco: p.preco_pendente ? "" : centavosParaCampo(p.preco), volume_unidade: p.volume_unidade ?? 1, unidades_pacote: p.unidades_pacote ?? 1,
    ativo: p.ativo, disponivel: p.disponivel, estoque: p.estoque, existente: true,
  })));
  const alterarVariacao = (id: string, campos: Partial<VariacaoRascunho>) => setVariacoes((vs) => vs.map((v) => v.id === id ? { ...v, ...campos } : v));
  const [componentes, setComponentes] = useState(dados.componentes);
  const [aba, setAba] = useState("gerais");
  const [erros, setErros] = useState<Record<string, string | undefined>>({});
  const [salvando, setSalvando] = useState(false);
  const uploads = useUploadsPendentes();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const emSalvar = useRef(false);
  const montado = useRef(true);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; if (!emSalvar.current) uploads.concluir(null); };
  }, [uploads]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emSalvar.current) return;
    const preco = paraCentavos(f.preco);
    const novos: Record<string, string> = {};
    if (!f.nome.trim()) novos.nome = "Informe o nome.";
    if (!comVariacoes && preco === null) novos.preco = "Informe um preço válido (ex.: 49,90).";
    if (!comVariacoes && !f.eh_kit && f.unidade_estoque === "ml" && (!Number.isInteger(f.volume_unidade) || (f.volume_unidade ?? 0) < 1 || (f.volume_unidade ?? 0) > 1000000)) novos.volume = "Informe o volume inteiro consumido por venda em ml.";
    if (!f.eh_kit && f.unidade_estoque !== "ml" && (!Number.isInteger(f.unidades_pacote ?? 1) || (f.unidades_pacote ?? 1) < 1 || (f.unidades_pacote ?? 1) > 1000000)) novos.pacote = "Informe quantas unidades vêm no pacote (de 1 a 1.000.000).";
    if (f.eh_kit && (!componentes.length || componentes.some((l) => !l.componente_id || !Number.isInteger(l.quantidade) || l.quantidade < 1 || l.quantidade > 1000000))) novos.kit = "Selecione os componentes e informe o consumo de cada um.";
    if (comVariacoes) {
      if (!f.nome.trim() || f.nome.trim().length > 60) novos.nome = "Informe o nome do produto (até 60 caracteres).";
      if (!atributo.trim()) novos.variacoes = "Informe o tipo da variação: sabor, tamanho…";
      if (!variacoes.length || variacoes.some((v) => !v.nome.trim() || v.nome.trim().length > 35 || paraCentavos(v.preco) === null || (f.unidade_estoque === "ml" && (!Number.isInteger(v.volume_unidade) || v.volume_unidade < 1 || v.volume_unidade > 1000000)))) novos.variacoes = "Preencha o nome, preço e volume válido de cada variação.";
      if (f.unidade_estoque !== "ml" && variacoes.some((v) => !Number.isInteger(v.unidades_pacote) || v.unidades_pacote < 1 || v.unidades_pacote > 1000000)) novos.variacoes = "Informe uma quantidade válida de unidades por pacote para cada variação.";
      if (new Set(variacoes.map((v) => v.nome.trim().toLocaleLowerCase())).size !== variacoes.length) novos.variacoes = "Use nomes diferentes para as variações.";
    }
    setErros(novos);
    if (Object.keys(novos).length) {
      setAba(novos.nome || novos.preco || novos.volume || novos.pacote ? "gerais" : novos.variacoes ? "variacoes" : novos.kit ? "composicao" : "gerais");
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not([type="hidden"])')?.focus());
      toast.error("Confira os campos destacados."); return;
    }
    emSalvar.current = true; setSalvando(true);
    let salvo = false;
    try {
      const p_dados = { categoria_id: f.categoria_id, nome: f.nome.trim(), descricao: f.descricao.trim(), preco,
        foto_url: f.foto_url, destaque: f.destaque, disponivel: f.disponivel, ativo: f.ativo,
        controla_estoque: f.controla_estoque, eh_kit: !!f.eh_kit,
        unidade_estoque: f.unidade_estoque ?? "un", volume_unidade: f.volume_unidade ?? 1, unidades_pacote: f.unidades_pacote ?? 1, vende_pacote: !!f.vende_pacote };
      const sb = supabaseNavegador();
      const { data, error } = comVariacoes
        ? await sb.rpc("salvar_produto_variacoes", { p_familia: f.familia_id ?? f.id, p_dados, p_atributo: atributo.trim(),
          p_variacoes: variacoes.map((v) => ({ id: v.id, nome: v.nome.trim(), preco: paraCentavos(v.preco), volume_unidade: v.volume_unidade, unidades_pacote: v.unidades_pacote, ativo: v.ativo, disponivel: v.disponivel })) })
        : await sb.rpc("salvar_produto_com_kit", { p_id: f.id, p_dados, p_componentes: f.eh_kit ? componentes : [] });
      if (error || !data) { setErros({ geral: error?.message ?? "Não foi possível salvar." }); return; }
      salvo = true;
      uploads.concluir(f.foto_url);
      if (existente && !dados.produto.familia_id && !comVariacoes && dados.produto.foto_url && dados.produto.foto_url !== f.foto_url) void removerImagem(dados.produto.foto_url);
      await revalidarLoja().catch(() => null);
      toast.success(existente ? "Produto atualizado" : "Produto criado");
      router.push("/admin/produtos"); router.refresh();
    } catch {
      setErros({ geral: "Falha de conexão. Seus dados continuam aqui; tente salvar novamente." });
    } finally {
      emSalvar.current = false;
      if (montado.current) setSalvando(false);
      else if (!salvo) uploads.concluir(null);
    }
  };

  const tipoAtual = comVariacoes ? "Com variações" : f.eh_kit ? "Kit / fardo / copão" : "Produto simples";
  const abas = [
    { id: "gerais", nome: "Dados gerais" },
    ...(comVariacoes ? [{ id: "variacoes", nome: "Variações" }] : []),
    ...(f.eh_kit ? [{ id: "composicao", nome: "Composição" }] : []),
    { id: "fotos", nome: "Fotos" },
    ...(existente ? [{ id: "adicionais", nome: "Adicionais" }] : []),
  ];
  const painel = "cadastro-painel space-y-5 data-[state=inactive]:hidden";

  return <form ref={formRef} onSubmit={enviar} noValidate data-testid="cadastro-produto" className="cadastro-erp mx-auto min-w-0 max-w-[1120px] text-sm">
    <div className="mb-5 flex items-center gap-2 text-xs text-suave">
      <button type="button" className="cursor-pointer hover:text-rosa-texto" disabled={salvando} onClick={() => router.push("/admin/produtos")}>Produtos</button>
      <span aria-hidden>/</span><span>{existente ? "Editar cadastro" : "Novo cadastro"}</span>
    </div>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button type="button" variant="suave" size="icone-sm" disabled={salvando} aria-label="Voltar para produtos" onClick={() => router.push("/admin/produtos")}><ArrowLeft /></Button>
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-rosa/20 bg-rosa/10 text-rosa-texto"><Package className="size-5" aria-hidden /></div>
        <div className="min-w-0"><h1 className="truncate text-lg font-semibold" title={f.nome}>{f.nome.trim() || (existente ? "Editar produto" : "Novo produto")}</h1><p className="mt-0.5 text-xs text-suave">{tipoAtual} · {existente ? "Editar produto" : "Novo produto"}</p></div>
      </div>
      <Button type="submit" size="sm" className="rounded-lg shadow-none" disabled={salvando}><Check />{salvando ? "Salvando…" : "Salvar produto"}</Button>
    </header>
    {erros.geral && <p role="alert" className="mb-4 rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">{erros.geral}</p>}
    <fieldset disabled={salvando} className="min-w-0">
      <legend className="sr-only">Cadastro do produto</legend>
      <Tabs.Root value={aba} onValueChange={setAba}>
        <div className="mb-5 overflow-x-auto border-b border-borda">
          <Tabs.List aria-label="Seções do cadastro" className="flex min-w-max gap-5">
            {abas.map((a) => <Tabs.Trigger key={a.id} value={a.id} aria-label={a.nome} disabled={salvando} className="cursor-pointer border-b-2 border-transparent px-0.5 py-3 text-[13px] text-suave outline-none transition-colors hover:text-texto focus-visible:ring-2 focus-visible:ring-rosa data-[state=active]:border-rosa data-[state=active]:font-medium data-[state=active]:text-rosa-texto">{a.nome}{a.id === "variacoes" && <span className="ml-1.5 rounded bg-rosa/10 px-1.5 py-0.5 text-[10px] text-rosa-texto">{variacoes.length}</span>}</Tabs.Trigger>)}
          </Tabs.List>
        </div>

        <Tabs.Content value="gerais" forceMount className={painel}>
          <div><h2 className="font-semibold">Dados do produto</h2><p className="mt-1 text-xs text-suave">Informações principais para o cadastro e a venda.</p></div>
          {dados.produto.preco_pendente && <p role="status" className="rounded-lg border border-amarelo/30 bg-amarelo/5 px-3 py-2 text-xs text-amarelo-texto">Preço não informado na importação. Preencha o preço para concluir este cadastro.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-2"><Campo label="Nome" htmlFor="p-nome" erro={erros.nome}><Input id="p-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={comVariacoes ? 60 : 100} aria-invalid={!!erros.nome} /></Campo></div>
            <Campo label="Tipo de produto" htmlFor="p-tipo"><Select id="p-tipo" disabled={!!f.familia_id} value={comVariacoes ? "variacoes" : f.eh_kit ? "kit" : "simples"} onChange={(e) => {
              const tipo = e.target.value; const kit = tipo === "kit";
              setComVariacoes(tipo === "variacoes"); set("eh_kit", kit);
              if (tipo === "variacoes" && !variacoes.length) setVariacoes([{ id: f.id, nome: "", preco: f.preco, volume_unidade: f.volume_unidade ?? 1, unidades_pacote: f.unidades_pacote ?? 1, ativo: f.ativo, disponivel: f.disponivel, estoque: f.estoque, existente }]);
              if (kit && !componentes.length) setComponentes([{ componente_id: "", quantidade: 1 }]);
            }}><option value="simples">Produto simples</option><option value="variacoes">Produto com variações</option><option value="kit">Kit / fardo / copão</option></Select></Campo>
            <Campo label="Categoria" htmlFor="p-cat"><Select id="p-cat" value={f.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value || null)}><option value="">Sem categoria</option>{dados.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Campo>
            {!comVariacoes && <Campo label="Preço (R$)" htmlFor="p-preco" erro={erros.preco}><Input id="p-preco" inputMode="decimal" placeholder="0,00" value={f.preco} onChange={(e) => set("preco", e.target.value.replace(/[^\d,.]/g, ""))} aria-invalid={!!erros.preco} /></Campo>}
          </div>
          <Campo label="Descrição" htmlFor="p-desc" ajuda={`${f.descricao.length}/500 caracteres`}><Textarea id="p-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={500} rows={3} /></Campo>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-borda pt-4">
            {!comVariacoes && <><OpcaoCadastro rotulo="Visível na loja" checked={f.ativo} onChange={(v) => set("ativo", v)} /><OpcaoCadastro rotulo="Disponível para venda" checked={f.disponivel} onChange={(v) => set("disponivel", v)} /></>}
            <OpcaoCadastro rotulo="Destaque" checked={f.destaque} onChange={(v) => set("destaque", v)} />
          </div>
        <section aria-label="Controle de estoque" className="space-y-4 border-t border-borda pt-5">
          <div><h2 className="font-semibold">Controle de estoque</h2><p className="mt-1 text-xs text-suave">Unidades, volume e saldo do produto.</p></div>
          {f.eh_kit ? <div className="rounded-lg border border-borda bg-superficie px-4 py-3 text-suave">O saldo deste kit é calculado pelos componentes. Faça as entradas nos produtos simples, na tela Estoque.</div> : <>
            {comVariacoes ? <p className="text-xs text-suave">Cada variação tem seu próprio saldo. Consulte as quantidades na aba Variações.</p> : <OpcaoCadastro rotulo="Controlar estoque" checked={f.controla_estoque} onChange={(v) => set("controla_estoque", v)} />}
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <Campo label="Unidade do estoque" htmlFor="p-unidade" ajuda="Defina antes de lançar o saldo."><Select id="p-unidade" value={f.unidade_estoque ?? "un"} onChange={(e) => { set("unidade_estoque", e.target.value as "un" | "ml"); if (e.target.value === "ml") set("vende_pacote", false); }}><option value="un">UN · Unidade (folha, lata, peça)</option><option value="ml">Mililitros (ml)</option></Select></Campo>
              {f.unidade_estoque !== "ml" && <Campo label="Unidade de venda" htmlFor="p-venda" ajuda="O preço cadastrado corresponde à unidade escolhida."><Select id="p-venda" value={f.vende_pacote ? "pacote" : "avulsa"} onChange={(e) => set("vende_pacote", e.target.value === "pacote")}><option value="avulsa">UN · Unidade avulsa</option><option value="pacote">PCT · Pacote completo</option></Select></Campo>}
              {f.unidade_estoque !== "ml" && <Campo label="Unidades por pacote" htmlFor="p-pacote" erro={erros.pacote} ajuda={comVariacoes ? "Aplicado à grade; você pode ajustar cada variação depois." : "Ex.: 50 folhas por pacote. Use 1 para entradas somente avulsas."}><Input id="p-pacote" type="number" min={1} max={1000000} step={1} value={f.unidades_pacote ?? 1} onChange={(e) => { const quantidade = Number(e.target.value); set("unidades_pacote", quantidade); if (comVariacoes) setVariacoes((vs) => vs.map((v) => ({ ...v, unidades_pacote: quantidade }))); }} aria-invalid={!!erros.pacote} /></Campo>}
              {!comVariacoes && f.unidade_estoque === "ml" && <Campo label="Volume por venda (ml)" htmlFor="p-volume" erro={erros.volume} ajuda="1 litro = 1.000 ml. Garrafa de 900 ml = 900."><Input id="p-volume" type="number" min={1} max={1000000} value={f.volume_unidade ?? 1} onChange={(e) => set("volume_unidade", Number(e.target.value))} aria-invalid={!!erros.volume} /></Campo>}
            </div>
            {f.unidade_estoque !== "ml" && (f.unidades_pacote ?? 1) > 1 && <p className="text-xs text-rosa-texto">1 pacote = {f.unidades_pacote} UN. {f.vende_pacote ? `Cada venda deste produto baixa ${f.unidades_pacote} UN.` : "Cada venda deste produto baixa 1 UN."} Na entrada, escolha pacotes ou unidades avulsas.</p>}
            {f.unidade_estoque === "ml" && !comVariacoes && <p className="text-xs text-rosa-texto">Cada venda baixa {f.volume_unidade ?? 1} ml do saldo.</p>}
            {!comVariacoes && <div className="inline-flex items-baseline gap-3 rounded-lg border border-borda bg-superficie px-4 py-3"><span className="text-xs text-suave">Saldo atual</span><strong className="font-mono text-lg font-medium">{f.estoque} <span className="text-xs font-normal text-suave">{f.unidade_estoque ?? "un"}</span></strong></div>}
            <p className="text-xs text-suave">Entradas e ajustes são feitos em Estoque. O cadastro preserva o saldo atual.</p>
          </>}
        </section>
        </Tabs.Content>

        {comVariacoes && <Tabs.Content value="variacoes" forceMount className={painel}>
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Variações do produto</h2><p className="mt-1 text-xs text-suave">Defina as opções e os preços de cada variação.</p></div><Button type="button" variant="suave" size="sm" disabled={variacoes.length >= 50} onClick={() => setVariacoes((vs) => [...vs, { id: crypto.randomUUID(), nome: "", preco: f.preco, volume_unidade: f.volume_unidade ?? 1, unidades_pacote: f.unidades_pacote ?? 1, ativo: true, disponivel: true, estoque: 0, existente: false }])}><Plus /> Adicionar variação</Button></div>
          <div className="max-w-xs"><Campo label="Tipo da variação" htmlFor="v-atributo" ajuda="Ex.: Sabor, Tamanho ou Sabor / tamanho."><Input id="v-atributo" maxLength={30} value={atributo} onChange={(e) => setAtributo(e.target.value)} /></Campo></div>
          {erros.variacoes && <p role="alert" className="text-sm text-perigo">{erros.variacoes}</p>}
          <div className="border-t border-borda pt-5"><h3 className="mb-3 font-medium">Grade de variações <span className="ml-1 text-xs font-normal text-suave">({variacoes.length})</span></h3>
            <div className="relative overflow-x-auto rounded-lg border border-borda">
              <table className="w-full min-w-[690px] border-collapse text-left text-[13px]">
                <thead className="bg-superficie-2 text-xs font-normal text-suave"><tr><th scope="col" className="px-3 py-2.5 font-medium">Variação</th><th scope="col" className="w-36 px-3 py-2.5 font-medium">Preço (R$)</th>{f.unidade_estoque === "ml" && <th scope="col" className="w-32 px-3 py-2.5 font-medium">ml / venda</th>}{f.unidade_estoque !== "ml" && <th scope="col" className="w-28 px-3 py-2.5 font-medium">UN / pacote</th>}<th scope="col" className="w-24 px-3 py-2.5 text-right font-medium">Estoque</th><th scope="col" className="w-20 px-3 py-2.5 text-center font-medium">Visível</th><th scope="col" className="w-24 px-3 py-2.5 text-center font-medium">Disponível</th><th scope="col" className="w-12"><span className="sr-only">Ações</span></th></tr></thead>
                <tbody className="divide-y divide-borda">{variacoes.map((v, i) => <tr key={v.id} className="bg-superficie/40 hover:bg-superficie-2/60">
                  <td className="px-3 py-2"><Input id={`v-nome-${i}`} aria-label={`Nome da variação ${i + 1}`} maxLength={35} placeholder="Melancia, 269 ml…" value={v.nome} onChange={(e) => alterarVariacao(v.id, { nome: e.target.value })} aria-invalid={!!erros.variacoes && !v.nome.trim()} /></td>
                  <td className="px-3 py-2"><Input id={`v-preco-${i}`} aria-label={`Preço da variação ${i + 1} (R$)`} className="font-mono" inputMode="decimal" placeholder="0,00" value={v.preco} onChange={(e) => alterarVariacao(v.id, { preco: e.target.value.replace(/[^\d,.]/g, "") })} aria-invalid={!!erros.variacoes && paraCentavos(v.preco) === null} /></td>
                  {f.unidade_estoque === "ml" && <td className="px-3 py-2"><Input id={`v-volume-${i}`} aria-label={`Volume da variação ${i + 1} (ml)`} type="number" min={1} max={1000000} value={v.volume_unidade} onChange={(e) => alterarVariacao(v.id, { volume_unidade: Number(e.target.value) })} /></td>}
                  {f.unidade_estoque !== "ml" && <td className="px-3 py-2"><Input aria-label={`Unidades por pacote da variação ${i + 1}`} type="number" min={1} max={1000000} step={1} value={v.unidades_pacote} onChange={(e) => alterarVariacao(v.id, { unidades_pacote: Number(e.target.value) })} /></td>}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-suave">{v.estoque} <span className="text-[11px]">{f.unidade_estoque ?? "un"}</span></td>
                  <td className="px-3 py-2"><OpcaoCadastro centralizada rotulo={`Visível: ${v.nome || `variação ${i + 1}`}`} checked={v.ativo} onChange={(ativo) => alterarVariacao(v.id, { ativo })} /></td>
                  <td className="px-3 py-2"><OpcaoCadastro centralizada rotulo={`Disponível: ${v.nome || `variação ${i + 1}`}`} checked={v.disponivel} onChange={(disponivel) => alterarVariacao(v.id, { disponivel })} /></td>
                  <td className="px-2 py-2"><Button type="button" size="icone-sm" variant="fantasma" disabled={v.existente} title={v.existente ? "Desative a visibilidade para retirar esta opção da loja" : "Remover variação"} aria-label={`Remover variação ${i + 1}`} onClick={() => setVariacoes((vs) => vs.filter((x) => x.id !== v.id))}><Trash2 /></Button></td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-suave">Entradas e ajustes de saldo na tela Estoque. Para retirar uma variação já cadastrada, desmarque Visível.</p>
          </div>
        </Tabs.Content>}

        {f.eh_kit && <Tabs.Content value="composicao" forceMount className={painel}>
          <div><h2 className="font-semibold">Composição do kit</h2><p className="mt-1 text-xs text-suave">Itens consumidos em cada unidade vendida.</p></div>
          {erros.kit && <p role="alert" className="text-sm text-perigo">{erros.kit}</p>}
          <div className="max-w-4xl"><EditorKit produtos={dados.bases} value={componentes} onChange={setComponentes} disabled={salvando} /></div>
        </Tabs.Content>}



        <Tabs.Content value="fotos" forceMount className={painel}>
          <div><h2 className="font-semibold">Foto do produto</h2><p className="mt-1 text-xs text-suave">Imagem exibida na loja{comVariacoes ? " para todas as variações" : ""}.</p></div>
          <div className="max-w-xs"><UploadImagem valor={f.foto_url} onChange={(url) => { uploads.registrar(url); set("foto_url", url); }} pasta="produtos" proporcao="aspect-square" /></div>
        </Tabs.Content>

        {existente && <Tabs.Content value="adicionais" forceMount className={painel}>
          <div><h2 className="font-semibold">Adicionais</h2><p className="mt-1 text-xs text-suave">As alterações de adicionais são salvas na hora.</p></div>
          {comVariacoes ? <div className="divide-y divide-borda">{variacoes.filter((v) => v.existente).map((v) => <details key={v.id} className="py-3"><summary className="cursor-pointer text-sm font-medium">{v.nome || "Variação sem nome"}</summary><div className="mt-3"><EditorAdicionais produtoId={v.id} /></div></details>)}</div> : <EditorAdicionais produtoId={f.id} />}
        </Tabs.Content>}
      </Tabs.Root>
    </fieldset>
    <footer className="sticky bottom-20 z-20 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-borda bg-fundo/95 py-3 backdrop-blur md:bottom-0">
      <p className="text-xs text-suave">{salvando ? "Salvando cadastro…" : "Salve para aplicar as alterações do cadastro."}</p>
      <div className="flex items-center gap-2"><Button type="button" size="sm" variant="suave" disabled={salvando} onClick={() => router.push("/admin/produtos")}>Cancelar</Button><Button type="submit" size="sm" className="shadow-none" disabled={salvando}><Check />{salvando ? "Salvando…" : "Salvar cadastro"}</Button></div>
    </footer>
  </form>;
}

function OpcaoCadastro({ rotulo, checked, onChange, centralizada = false }: { rotulo: string; checked: boolean; onChange: (checked: boolean) => void; centralizada?: boolean }) {
  return <label className={`relative flex min-h-9 cursor-pointer items-center gap-2 ${centralizada ? "justify-center" : ""}`}>
    <input type="checkbox" className="size-4 shrink-0 cursor-pointer accent-rosa" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className={centralizada ? "sr-only" : "text-[13px]"}>{rotulo}</span>
  </label>;
}
