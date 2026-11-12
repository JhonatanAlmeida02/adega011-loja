"use client";

import { useEffect, useState } from "react";
import { Link2, Search } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Produto } from "@/lib/tipos";
import { formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import { MiniaturaProduto } from "./miniatura-produto";

/** Pesquisa no banco apenas enquanto o seletor está aberto. */
export function VincularProdutoVariacao({ excluidos, unidade, vendePacote, onVincular }: {
  excluidos: string;
  unidade: "un" | "ml";
  vendePacote: boolean;
  onVincular: (produto: Produto) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [resultado, setResultado] = useState<{ produtos: Produto[]; erro: string } | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const abortar = new AbortController();
    const timer = setTimeout(async () => {
      try {
        let consulta = supabaseNavegador().from("produtos").select("*")
          .eq("eh_kit", false).is("familia_id", null)
          .eq("unidade_estoque", unidade).eq("vende_pacote", vendePacote)
          .not("id", "in", `(${excluidos})`).order("nome").limit(20);
        const palavras = busca.trim().split(/\s+/).filter(Boolean);
        for (const palavra of palavras) consulta = consulta.ilike("nome", `%${palavra.replace(/[\\%_]/g, "\\$&")}%`);
        const { data, error } = await consulta.abortSignal(abortar.signal);
        if (!abortar.signal.aborted) setResultado({ produtos: (data ?? []) as Produto[], erro: error ? "Não foi possível pesquisar. Tente novamente." : "" });
      } catch {
        if (!abortar.signal.aborted) setResultado({ produtos: [], erro: "Sem conexão. Tente novamente." });
      }
    }, 250);
    return () => { clearTimeout(timer); abortar.abort(); };
  }, [aberto, busca, excluidos, unidade, vendePacote]);

  return <div className="space-y-2">
    <Button type="button" size="sm" variant="suave" aria-expanded={aberto} aria-controls="vincular-variacao" onClick={() => { setAberto(!aberto); setResultado(null); }}><Link2 />{aberto ? "Fechar pesquisa" : "Vincular produto existente"}</Button>
    {aberto && <div id="vincular-variacao" className="space-y-2 rounded-lg border border-borda p-3">
      <p className="text-xs text-suave">Selecione um produto simples sem pai e com a mesma unidade e forma de venda. O estoque, a foto e o histórico continuam no mesmo cadastro. O vínculo é aplicado ao salvar.</p>
      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
        <Input type="search" autoComplete="off" aria-label="Pesquisar produto existente" placeholder="Pesquisar produto existente…" className="h-9 pl-9" value={busca} onChange={(e) => { setBusca(e.target.value); setResultado(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
      </div>
      <div aria-live="polite">
        {!resultado ? <p className="text-xs text-suave">Pesquisando…</p> : resultado.erro ? <p role="alert" className="text-xs text-perigo">{resultado.erro}</p> : !resultado.produtos.length ? <p className="text-xs text-suave">Nenhum produto disponível para vincular. Confira a pesquisa e a unidade do pai.</p> : <>
          <ul className="max-h-64 divide-y divide-borda overflow-y-auto rounded-lg border border-borda">
            {resultado.produtos.map((p) => <li key={p.id}><button type="button" className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-rosa" onClick={() => { onVincular(p); setResultado(null); }}>
              <MiniaturaProduto foto={p.foto_url} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{p.nome}</span><span className="block text-xs text-suave">{p.preco_pendente ? "Sem preço" : formatarPreco(p.preco)} · Estoque: {p.estoque} {p.unidade_estoque}</span></span>
              <Link2 aria-hidden className="size-4 shrink-0 text-suave" />
            </button></li>)}
          </ul>
          <p className="mt-2 text-xs text-suave">Até 20 resultados. Digite mais palavras para refinar.</p>
        </>}
      </div>
    </div>}
  </div>;
}
