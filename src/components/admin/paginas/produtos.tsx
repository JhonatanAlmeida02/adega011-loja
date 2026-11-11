"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { agruparVariacoes, textoBuscaProduto } from "@/lib/variacoes";
import { combina } from "@/lib/busca";
import { salvar, useTabela } from "@/lib/admin/dados";
import { removerImagem } from "@/lib/admin/imagens";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { saldoVendavel, type Categoria, type Produto } from "@/lib/tipos";
import { cn, formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Confirmar, Vazio } from "../ui";

export function PaginaProdutos() {
  const produtos = useTabela<Produto>("produtos");
  const categorias = useTabela<Categoria>("categorias");
  const [filtro, setFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const router = useRouter();

  const nomeCat = useMemo(() => new Map(categorias.dados.map((c) => [c.id, c.nome])), [categorias.dados]);

  const visiveis = useMemo(() => {
    let lista = produtos.dados;
    if (filtro === "sem") lista = lista.filter((p) => !p.categoria_id);
    else if (filtro !== "todas") lista = lista.filter((p) => p.categoria_id === filtro);
    if (busca.trim()) lista = lista.filter((p) => combina(`${p.familia_nome ?? ""} ${textoBuscaProduto(p)}`, busca));
    return agruparVariacoes([...lista].sort((a, b) => a.ordem - b.ordem));
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
    const comOrdem = novos.flatMap((p, i) => (p.variacoes ?? [p]).map((v) => ({ ...v, ordem: i })));
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
    router.push(`/admin/produtos/novo${cat ? `?categoria=${encodeURIComponent(cat)}` : ""}`);
  };

  if (produtos.carregando || categorias.carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos"
        descricao={`${produtos.dados.length} itens cadastrados, incluindo variações`}
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
      {filtro === "todas" && visiveis.length > 1 && (
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
                  {p.variacoes?.length ? <span className="ml-1 text-rosa">· {p.variacoes.length} variações: {p.variacoes.map((v) => v.variacao_nome).join(", ")}</span> : p.eh_kit ? <span className="ml-1 text-rosa">· Kit: estoque dos componentes</span> : p.controla_estoque && (
                    <span className={cn("ml-1 font-mono", p.estoque <= 0 ? "text-perigo" : p.estoque <= 5 ? "text-amarelo" : "")}>
                      · {p.estoque} {p.unidade_estoque ?? "un"} em estoque{p.vende_pacote && <> · {saldoVendavel(p)} PCT disponíveis · baixa {p.unidades_pacote} UN / venda</>}
                    </span>
                  )}
                </p>
              </div>
              {!p.variacoes?.length && <div className="flex items-center gap-4">
                <MiniInterruptor rotulo="Disponível" checked={p.disponivel} onChange={() => alternar(p, "disponivel")} nome={p.nome} />
                <MiniInterruptor rotulo="Destaque" checked={p.destaque} onChange={() => alternar(p, "destaque")} nome={p.nome} />
                <MiniInterruptor rotulo="Visível" checked={p.ativo} onChange={() => alternar(p, "ativo")} nome={p.nome} />
              </div>}
              <div className="ml-auto flex gap-1">
                <Button
                  variant="suave"
                  size="icone"
                  aria-label={`Editar ${p.nome}`}
                  onClick={() => router.push(`/admin/produtos/${p.variacoes?.[0]?.id ?? p.id}`)}
                >
                  <Pencil />
                </Button>
                {!p.variacoes?.length && <Confirmar titulo="Excluir produto?" descricao={`“${p.nome}” será removido do cardápio. Isso não pode ser desfeito.`} onConfirmar={() => excluir(p)}>
                  <Button variant="fantasma" size="icone" aria-label={`Excluir ${p.nome}`}>
                    <Trash2 />
                  </Button>
                </Confirmar>}
              </div>
            </div>
          )}
        />
      )}


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
