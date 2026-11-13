"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { salvar, useTabela } from "@/lib/admin/dados";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Categoria } from "@/lib/tipos";
import { ordenarArvore } from "@/lib/categorias";
import { cn, gerarSlug } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor, Select } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Cartao, Confirmar, Vazio } from "../ui";

export function PaginaCategorias() {
  const { dados, setDados, carregando } = useTabela<Categoria>("categorias");
  const [nova, setNova] = useState("");
  const [novaPai, setNovaPai] = useState("");
  // Cada principal seguida das suas subcategorias (Destilados, Vodka, Gin…)
  const arvore = useMemo(() => ordenarArvore(dados), [dados]);
  const principais = arvore.filter((c) => c.nivel === 0);
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);

  const slugUnico = (nome: string, ignorar?: string) => {
    const base = gerarSlug(nome) || "categoria";
    let slug = base;
    for (let i = 2; dados.some((c) => c.slug === slug && c.id !== ignorar); i++) slug = `${base}-${i}`;
    return slug;
  };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    const registro = { nome, slug: slugUnico(nome), ordem: dados.length, ativa: true, pai_id: novaPai || null };
    const resp = await supabaseNavegador().from("categorias").insert(registro).select().single();
    if (await salvar(Promise.resolve(resp), "Categoria criada")) {
      setDados((l) => [...l, resp.data as Categoria]);
      setNova("");
      setNovaPai("");
    }
  };

  const renomear = async () => {
    if (!editando) return;
    const nome = editando.nome.trim();
    if (!nome) return;
    const campos = { nome, slug: slugUnico(nome, editando.id) };
    if (await salvar(supabaseNavegador().from("categorias").update(campos).eq("id", editando.id), "Categoria renomeada")) {
      setDados((l) => l.map((c) => (c.id === editando.id ? { ...c, ...campos } : c)));
      setEditando(null);
    }
  };

  const alternar = async (c: Categoria) => {
    setDados((l) => l.map((x) => (x.id === c.id ? { ...x, ativa: !c.ativa } : x)));
    const ok = await salvar(supabaseNavegador().from("categorias").update({ ativa: !c.ativa }).eq("id", c.id), null);
    if (!ok) setDados((l) => l.map((x) => (x.id === c.id ? { ...x, ativa: c.ativa } : x)));
  };

  const mudarPai = async (c: Categoria, pai: string) => {
    const pai_id = pai || null;
    const ok = await salvar(supabaseNavegador().from("categorias").update({ pai_id }).eq("id", c.id), pai_id ? "Agora é subcategoria" : "Agora é categoria principal");
    if (ok) setDados((l) => l.map((x) => (x.id === c.id ? { ...x, pai_id } : x)));
  };

  const reordenar = async (novos: Categoria[]) => {
    const comOrdem = novos.map((c, i) => ({ ...c, ordem: i }));
    setDados(comOrdem);
    const sb = supabaseNavegador();
    await salvar(
      Promise.all(comOrdem.map((c) => sb.from("categorias").update({ ordem: c.ordem }).eq("id", c.id))).then((rs) => ({
        error: rs.find((r) => r.error)?.error ?? null,
      })),
      "Ordem salva",
    );
  };

  const excluir = async (c: Categoria) => {
    if (await salvar(supabaseNavegador().from("categorias").delete().eq("id", c.id), "Categoria excluída")) {
      setDados((l) => l.filter((x) => x.id !== c.id));
    }
  };

  if (carregando) return <Carregando />;

  return (
    <>
      <CabecalhoPagina titulo="Categorias" descricao="Arraste pela alça para mudar a ordem no cardápio. Para criar subcategorias (ex.: Vodka e Gin dentro de Destilados), escolha “Dentro de”." />

      <Cartao className="mb-5">
        <form onSubmit={criar} className="flex gap-2">
          <label htmlFor="nova-cat" className="sr-only">
            Nome da nova categoria
          </label>
          <Input id="nova-cat" placeholder="Nova categoria (ex.: Gelo e tabacaria)" value={nova} onChange={(e) => setNova(e.target.value)} maxLength={60} />
          <div className="w-32 shrink-0 sm:w-52">
            <Select aria-label="Dentro de (opcional)" value={novaPai} onChange={(e) => setNovaPai(e.target.value)}>
              <option value="">Principal</option>
              {principais.map((c) => <option key={c.id} value={c.id}>Dentro de {c.nome}</option>)}
            </Select>
          </div>
          <Button type="submit" disabled={!nova.trim()} className="shrink-0" aria-label="Adicionar categoria">
            <Plus /> <span className="hidden sm:inline">Adicionar</span>
          </Button>
        </form>
      </Cartao>

      {dados.length === 0 ? (
        <Vazio titulo="Sem categorias" texto="Crie categorias como Vinhos, Destilados, Cervejas e Combos." />
      ) : (
        <ListaOrdenavel
          itens={arvore}
          rotulo={(c) => c.nome}
          onReordenar={reordenar}
          renderizar={(c) =>
            editando?.id === c.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void renomear();
                }}
              >
                <label htmlFor={`ren-${c.id}`} className="sr-only">
                  Novo nome de {c.nome}
                </label>
                <Input
                  id={`ren-${c.id}`}
                  autoFocus
                  value={editando.nome}
                  onChange={(e) => setEditando({ id: c.id, nome: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setEditando(null)}
                  maxLength={60}
                />
                <Button type="submit" size="icone" aria-label="Salvar nome">
                  <Check />
                </Button>
                <Button type="button" variant="fantasma" size="icone" aria-label="Cancelar" onClick={() => setEditando(null)}>
                  <X />
                </Button>
              </form>
            ) : (
              <div className={cn("flex flex-wrap items-center gap-3", c.nivel === 1 && "border-l-2 border-rosa/40 pl-3")}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.nivel === 1 && <span aria-hidden className="mr-1 text-suave">↳</span>}{c.nome}</p>
                  <p className="rotulo text-[0.68rem] text-suave">{c.ativa ? "Visível" : "Oculta"} · #{c.slug}</p>
                </div>
                {/* Principal com subcategorias não pode virar subcategoria (só um nível) */}
                {dados.some((x) => x.pai_id === c.id) ? (
                  <span className="rotulo order-last w-full text-[0.68rem] text-suave sm:order-none sm:w-auto">{dados.filter((x) => x.pai_id === c.id).length === 1 ? "1 subcategoria" : `${dados.filter((x) => x.pai_id === c.id).length} subcategorias`}</span>
                ) : (
                  <div className="order-last w-full sm:order-none sm:w-44">
                    <Select aria-label={`${c.nome} fica dentro de`} value={c.pai_id ?? ""} onChange={(e) => void mudarPai(c, e.target.value)} className="h-9 text-xs">
                      <option value="">Principal</option>
                      {principais.filter((p) => p.id !== c.id).map((p) => <option key={p.id} value={p.id}>Dentro de {p.nome}</option>)}
                    </Select>
                  </div>
                )}
                <Interruptor checked={c.ativa} onCheckedChange={() => alternar(c)} label={`Categoria ${c.nome} visível`} />
                <Button variant="suave" size="icone" aria-label={`Renomear ${c.nome}`} onClick={() => setEditando({ id: c.id, nome: c.nome })}>
                  <Pencil />
                </Button>
                <Confirmar
                  titulo="Excluir categoria?"
                  descricao={`Os produtos de “${c.nome}” não serão apagados: ficam como “Sem categoria”.`}
                  onConfirmar={() => excluir(c)}
                >
                  <Button variant="fantasma" size="icone" aria-label={`Excluir ${c.nome}`}>
                    <Trash2 />
                  </Button>
                </Confirmar>
              </div>
            )
          }
        />
      )}
    </>
  );
}
