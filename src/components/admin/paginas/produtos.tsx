"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { combina } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { removerImagem } from "@/lib/admin/imagens";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Categoria, Produto } from "@/lib/tipos";
import { centavosParaCampo, cn, formatarPreco, paraCentavos } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor, Select, Textarea } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Confirmar, LinhaInterruptor, UploadImagem, Vazio } from "../ui";

type Rascunho = Omit<Produto, "id" | "preco"> & { id?: string; preco: string };

const NOVO = (categoria_id: string | null, ordem: number): Rascunho => ({
  categoria_id,
  nome: "",
  descricao: "",
  preco: "",
  foto_url: null,
  destaque: false,
  disponivel: true,
  ativo: true,
  ordem,
});

export function PaginaProdutos() {
  const produtos = useTabela<Produto>("produtos");
  const categorias = useTabela<Categoria>("categorias");
  const [filtro, setFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Rascunho | null>(null);

  const nomeCat = useMemo(() => new Map(categorias.dados.map((c) => [c.id, c.nome])), [categorias.dados]);

  const visiveis = useMemo(() => {
    let lista = produtos.dados;
    if (filtro === "sem") lista = lista.filter((p) => !p.categoria_id);
    else if (filtro !== "todas") lista = lista.filter((p) => p.categoria_id === filtro);
    if (busca.trim()) lista = lista.filter((p) => combina(`${p.nome} ${p.descricao}`, busca));
    return [...lista].sort((a, b) => a.ordem - b.ordem);
  }, [produtos.dados, filtro, busca]);

  // Arrastar só faz sentido dentro de uma categoria e sem busca.
  const podeOrdenar = filtro !== "todas" && !busca.trim();

  const atualizarLocal = (id: string, campos: Partial<Produto>) =>
    produtos.setDados((lista) => lista.map((p) => (p.id === id ? { ...p, ...campos } : p)));

  const alternar = async (p: Produto, campo: "disponivel" | "destaque" | "ativo") => {
    const valor = !p[campo];
    atualizarLocal(p.id, { [campo]: valor });
    const ok = await salvar(supabaseNavegador().from("produtos").update({ [campo]: valor }).eq("id", p.id), null);
    if (!ok) atualizarLocal(p.id, { [campo]: !valor });
  };

  const reordenar = async (novos: Produto[]) => {
    const comOrdem = novos.map((p, i) => ({ ...p, ordem: i }));
    produtos.setDados((lista) => lista.map((p) => comOrdem.find((n) => n.id === p.id) ?? p));
    const sb = supabaseNavegador();
    await salvar(
      Promise.all(comOrdem.map((p) => sb.from("produtos").update({ ordem: p.ordem }).eq("id", p.id))).then((rs) => ({
        error: rs.find((r) => r.error)?.error ?? null,
      })),
      "Ordem salva",
    );
  };

  const excluir = async (p: Produto) => {
    const ok = await salvar(supabaseNavegador().from("produtos").delete().eq("id", p.id), "Produto excluído");
    if (ok) {
      produtos.setDados((lista) => lista.filter((x) => x.id !== p.id));
      void removerImagem(p.foto_url);
    }
  };

  const novo = () => {
    const cat = filtro !== "todas" && filtro !== "sem" ? filtro : (categorias.dados[0]?.id ?? null);
    const ordem = Math.max(-1, ...produtos.dados.filter((p) => p.categoria_id === cat).map((p) => p.ordem)) + 1;
    setEditando(NOVO(cat, ordem));
  };

  if (produtos.carregando || categorias.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos"
        descricao={`${produtos.dados.length} produtos cadastrados`}
        acoes={
          <Button onClick={novo}>
            <Plus /> Novo produto
          </Button>
        }
      />

      <div className="relative mb-3">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-suave" />
        <Input
          type="search"
          aria-label="Buscar produto"
          placeholder="Buscar produto…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="rounded-full pl-12"
        />
      </div>
      <div className="sem-barra -mx-4 mb-5 flex gap-2 overflow-x-auto px-4" aria-label="Filtrar por categoria">
        {[{ id: "todas", nome: "Todas" }, ...categorias.dados, { id: "sem", nome: "Sem categoria" }].map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filtro === c.id}
            onClick={() => setFiltro(c.id)}
            className={cn(
              "rotulo h-11 shrink-0 cursor-pointer rounded-full border px-4 font-bold",
              filtro === c.id ? "border-rosa bg-rosa text-preto" : "border-borda hover:border-rosa/60",
            )}
          >
            {c.nome}
          </button>
        ))}
      </div>
      {!podeOrdenar && visiveis.length > 1 && (
        <p className="mb-3 text-sm text-suave">Dica: escolha uma categoria para reordenar os produtos arrastando.</p>
      )}

      {visiveis.length === 0 ? (
        <Vazio
          titulo="Nada por aqui"
          texto={busca ? "Nenhum produto encontrado com essa busca." : "Cadastre o primeiro produto desta categoria."}
          acao={<Button onClick={novo}><Plus /> Novo produto</Button>}
        />
      ) : (
        <ListaOrdenavel
          itens={visiveis}
          desabilitado={!podeOrdenar}
          rotulo={(p) => p.nome}
          onReordenar={reordenar}
          renderizar={(p) => (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-superficie-2">
                {p.foto_url && <Image src={p.foto_url} alt="" fill sizes="64px" className={cn("object-cover", !p.disponivel && "grayscale")} />}
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className={cn("font-bold leading-snug", !p.ativo && "text-suave line-through")}>{p.nome}</p>
                <p className="text-sm text-suave">
                  <span className="preco text-sm">{formatarPreco(p.preco)}</span>
                  {filtro === "todas" && <> · {p.categoria_id ? nomeCat.get(p.categoria_id) : "Sem categoria"}</>}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <MiniInterruptor rotulo="Disponível" checked={p.disponivel} onChange={() => alternar(p, "disponivel")} nome={p.nome} />
                <MiniInterruptor rotulo="Destaque" checked={p.destaque} onChange={() => alternar(p, "destaque")} nome={p.nome} />
                <MiniInterruptor rotulo="Visível" checked={p.ativo} onChange={() => alternar(p, "ativo")} nome={p.nome} />
              </div>
              <div className="ml-auto flex gap-1">
                <Button
                  variant="suave"
                  size="icone"
                  aria-label={`Editar ${p.nome}`}
                  onClick={() => setEditando({ ...p, preco: centavosParaCampo(p.preco) })}
                >
                  <Pencil />
                </Button>
                <Confirmar titulo="Excluir produto?" descricao={`“${p.nome}” será removido do cardápio. Isso não pode ser desfeito.`} onConfirmar={() => excluir(p)}>
                  <Button variant="fantasma" size="icone" aria-label={`Excluir ${p.nome}`}>
                    <Trash2 />
                  </Button>
                </Confirmar>
              </div>
            </div>
          )}
        />
      )}

      <FormProduto
        rascunho={editando}
        categorias={categorias.dados}
        onFechar={() => setEditando(null)}
        onSalvo={(p, novo) => {
          produtos.setDados((lista) => (novo ? [...lista, p] : lista.map((x) => (x.id === p.id ? p : x))));
          setEditando(null);
        }}
      />
    </>
  );
}

function MiniInterruptor({ rotulo, checked, onChange, nome }: { rotulo: string; checked: boolean; onChange: () => void; nome: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Interruptor checked={checked} onCheckedChange={onChange} label={`${rotulo}: ${nome}`} />
      <span className="text-[0.68rem] text-suave" aria-hidden>
        {rotulo}
      </span>
    </div>
  );
}

function FormProduto({
  rascunho,
  categorias,
  onFechar,
  onSalvo,
}: {
  rascunho: Rascunho | null;
  categorias: Categoria[];
  onFechar: () => void;
  onSalvo: (p: Produto, novo: boolean) => void;
}) {
  return (
    <Sheet open={!!rascunho} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="overflow-y-auto" rotuloFechar="Fechar formulário">
        {rascunho && (
          <ConteudoForm key={rascunho.id ?? "novo"} inicial={rascunho} categorias={categorias} onSalvo={onSalvo} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ConteudoForm({
  inicial,
  categorias,
  onSalvo,
}: {
  inicial: Rascunho;
  categorias: Categoria[];
  onSalvo: (p: Produto, novo: boolean) => void;
}) {
  const [f, setF] = useState<Rascunho>(inicial);
  const [erros, setErros] = useState<{ nome?: string; preco?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setF((x) => ({ ...x, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const preco = paraCentavos(f.preco);
    const novosErros = {
      nome: f.nome.trim() ? undefined : "Informe o nome.",
      preco: preco === null ? "Informe um preço válido (ex.: 49,90)." : undefined,
    };
    setErros(novosErros);
    if (novosErros.nome || novosErros.preco) return;

    const registro = {
      categoria_id: f.categoria_id || null,
      nome: f.nome.trim(),
      descricao: f.descricao.trim(),
      preco: preco!,
      foto_url: f.foto_url,
      destaque: f.destaque,
      disponivel: f.disponivel,
      ativo: f.ativo,
      ordem: f.ordem,
    };
    setSalvando(true);
    const sb = supabaseNavegador();
    const resp = f.id
      ? await sb.from("produtos").update(registro).eq("id", f.id).select().single()
      : await sb.from("produtos").insert(registro).select().single();
    setSalvando(false);
    const ok = await salvar(Promise.resolve(resp), f.id ? "Produto atualizado" : "Produto criado");
    if (ok && resp.data) {
      if (f.id && inicial.foto_url && inicial.foto_url !== f.foto_url) void removerImagem(inicial.foto_url);
      onSalvo(resp.data as Produto, !f.id);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-4 pr-16 md:px-6 md:pt-6">
        <SheetTitle className="titulo text-4xl">{f.id ? "Editar produto" : "Novo produto"}</SheetTitle>
        <SheetDescription className="sr-only">Preencha os dados do produto</SheetDescription>
      </div>
      <div className="flex-1 space-y-5 px-5 py-5 md:px-6">
        <UploadImagem valor={f.foto_url} onChange={(url) => set("foto_url", url)} pasta="produtos" proporcao="aspect-[4/3]" />
        <Campo label="Nome" htmlFor="p-nome" erro={erros.nome}>
          <Input id="p-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={100} aria-invalid={!!erros.nome} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Preço (R$)" htmlFor="p-preco" erro={erros.preco}>
            <Input
              id="p-preco"
              inputMode="decimal"
              placeholder="49,90"
              value={f.preco}
              onChange={(e) => set("preco", e.target.value.replace(/[^\d,.]/g, ""))}
              aria-invalid={!!erros.preco}
              className="font-mono"
            />
          </Campo>
          <Campo label="Categoria" htmlFor="p-cat">
            <Select id="p-cat" value={f.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value || null)}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Campo>
        </div>
        <Campo label="Descrição" htmlFor="p-desc" ajuda={`${f.descricao.length}/500`}>
          <Textarea id="p-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={500} rows={3} />
        </Campo>
        <div className="divide-y divide-borda rounded-2xl border border-borda px-4">
          <LinhaInterruptor rotulo="Disponível" descricao="Desligado = aparece como Esgotado" checked={f.disponivel} onChange={(v) => set("disponivel", v)} />
          <LinhaInterruptor rotulo="Destaque" descricao="Ganha o selo ★ Destaque" checked={f.destaque} onChange={(v) => set("destaque", v)} />
          <LinhaInterruptor rotulo="Visível na loja" descricao="Desligado = some do cardápio" checked={f.ativo} onChange={(v) => set("ativo", v)} />
        </div>
      </div>
      <div className="pb-seguro sticky bottom-0 border-t border-borda bg-superficie px-5 pt-4 md:px-6">
        <Button type="submit" size="lg" className="w-full" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar produto"}
        </Button>
      </div>
    </form>
  );
}
