"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { salvar, useTabela } from "@/lib/admin/dados";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Categoria } from "@/lib/tipos";
import { gerarSlug } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor } from "@/components/ui/campos";
import { ListaOrdenavel } from "../lista-ordenavel";
import { CabecalhoPagina, Carregando, Cartao, Confirmar, Vazio } from "../ui";

export function PaginaCategorias() {
  const { dados, setDados, carregando } = useTabela<Categoria>("categorias");
  const [nova, setNova] = useState("");
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
    const registro = { nome, slug: slugUnico(nome), ordem: dados.length, ativa: true };
    const resp = await supabaseNavegador().from("categorias").insert(registro).select().single();
    if (await salvar(Promise.resolve(resp), "Categoria criada")) {
      setDados((l) => [...l, resp.data as Categoria]);
      setNova("");
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
      <CabecalhoPagina titulo="Categorias" descricao="Arraste pela alça para mudar a ordem no cardápio." />

      <Cartao className="mb-5">
        <form onSubmit={criar} className="flex gap-2">
          <label htmlFor="nova-cat" className="sr-only">
            Nome da nova categoria
          </label>
          <Input id="nova-cat" placeholder="Nova categoria (ex.: Gelo e tabacaria)" value={nova} onChange={(e) => setNova(e.target.value)} maxLength={60} />
          <Button type="submit" disabled={!nova.trim()} className="shrink-0" aria-label="Adicionar categoria">
            <Plus /> <span className="hidden sm:inline">Adicionar</span>
          </Button>
        </form>
      </Cartao>

      {dados.length === 0 ? (
        <Vazio titulo="Sem categorias" texto="Crie categorias como Vinhos, Destilados, Cervejas e Combos." />
      ) : (
        <ListaOrdenavel
          itens={dados}
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
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.nome}</p>
                  <p className="rotulo text-[0.68rem] text-suave">{c.ativa ? "Visível" : "Oculta"} · #{c.slug}</p>
                </div>
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
