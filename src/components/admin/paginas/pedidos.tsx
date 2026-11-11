"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, MapPin, Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_ORIGEM, NOMES_PAGAMENTO, NOMES_STATUS, type Pedido, type StatusPedido } from "@/lib/tipos";
import { apenasDigitos, cn, formatarPreco, mascararTelefone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconeWhatsApp } from "@/components/marca/icones";
import { CabecalhoPagina, Carregando, Vazio } from "../ui";

const POR_PAGINA = 30;

const FILTROS: { id: string; rotulo: string; status: StatusPedido[] | null }[] = [
  { id: "abertos", rotulo: "Em aberto", status: ["novo", "confirmado", "em_entrega"] },
  { id: "novo", rotulo: "Novos", status: ["novo"] },
  { id: "concluido", rotulo: "Concluídos", status: ["concluido"] },
  { id: "cancelado", rotulo: "Cancelados", status: ["cancelado"] },
  { id: "todos", rotulo: "Todos", status: null },
];

const CORES_STATUS: Record<StatusPedido, string> = {
  novo: "bg-amarelo text-preto",
  confirmado: "bg-rosa text-preto",
  em_entrega: "bg-[#7dd3fc] text-preto",
  concluido: "bg-sucesso text-preto",
  cancelado: "bg-superficie-3 text-suave",
};

const PROXIMO: Partial<Record<StatusPedido, StatusPedido>> = {
  novo: "confirmado",
  confirmado: "em_entrega",
  em_entrega: "concluido",
};

const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function bip() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch {
    /* sem áudio */
  }
}

export function PaginaPedidos() {
  const [filtro, setFiltro] = useState("abertos");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [temMais, setTemMais] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [versao, setVersao] = useState(0);
  const [som, setSom] = useState(true);
  const somRef = useRef(som);
  useEffect(() => {
    somRef.current = som;
  }, [som]);

  const status = useMemo(() => FILTROS.find((f) => f.id === filtro)?.status ?? null, [filtro]);

  useEffect(() => {
    let ativo = true;
    let q = supabaseNavegador()
      .from("pedidos")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(limite + 1);
    if (status) q = q.in("status", status);
    q.then(({ data, error }) => {
      if (!ativo) return;
      if (error) toast.error(`Erro ao carregar pedidos: ${error.message}`);
      const lista = (data ?? []) as Pedido[];
      setTemMais(lista.length > limite);
      setPedidos(lista.slice(0, limite));
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, [status, limite, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // Tempo real: novos pedidos aparecem sozinhos (com aviso sonoro).
  useEffect(() => {
    const sb = supabaseNavegador();
    const canal = sb
      .channel("pedidos-admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, (payload) => {
        const p = payload.new as Pedido;
        toast.success(`Novo pedido #${p.numero} · ${formatarPreco(p.total)}`);
        if (somRef.current) bip();
        recarregar();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, recarregar)
      .subscribe();

    // Rede de segurança: o websocket pode cair com o celular em segundo plano.
    const aoVoltar = () => document.visibilityState === "visible" && recarregar();
    document.addEventListener("visibilitychange", aoVoltar);
    const intervalo = setInterval(() => document.visibilityState === "visible" && recarregar(), 30_000);

    return () => {
      void sb.removeChannel(canal);
      document.removeEventListener("visibilitychange", aoVoltar);
      clearInterval(intervalo);
    };
  }, [recarregar]);

  const mudarStatus = async (pedido: Pedido, novo: StatusPedido) => {
    const anterior = pedido.status;
    setPedidos((lista) => lista.map((p) => (p.id === pedido.id ? { ...p, status: novo } : p)));
    const { error } = await supabaseNavegador().from("pedidos").update({ status: novo }).eq("id", pedido.id);
    if (error) {
      setPedidos((lista) => lista.map((p) => (p.id === pedido.id ? { ...p, status: anterior } : p)));
      toast.error(`Não foi possível atualizar: ${error.message}`);
    } else {
      toast.success(`Pedido #${pedido.numero}: ${NOMES_STATUS[novo]}`);
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Pedidos"
        descricao="Pedidos registrados antes do envio pelo WhatsApp. Atualiza sozinho."
        acoes={
          <>
            <Button variant="suave" size="icone" onClick={() => setSom((s) => !s)} aria-label={som ? "Desativar som de novo pedido" : "Ativar som de novo pedido"} aria-pressed={som}>
              {som ? <Bell /> : <BellOff />}
            </Button>
            <Button variant="suave" size="icone" onClick={recarregar} aria-label="Atualizar lista">
              <RefreshCw />
            </Button>
          </>
        }
      />

      <div className="sem-barra -mx-4 mb-5 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Filtrar pedidos">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filtro === f.id}
            onClick={() => {
              setFiltro(f.id);
              setLimite(POR_PAGINA);
              setCarregando(true);
            }}
            className={cn(
              "rotulo h-11 shrink-0 cursor-pointer rounded-full border px-4 font-bold",
              filtro === f.id ? "border-rosa bg-rosa text-preto" : "border-borda text-branco hover:border-rosa/60",
            )}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {carregando ? (
        <Carregando />
      ) : pedidos.length === 0 ? (
        <Vazio titulo="Nenhum pedido aqui" texto="Quando um cliente finalizar um pedido na loja, ele aparece nesta lista." />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {pedidos.map((p) => (
            <CartaoPedido key={p.id} pedido={p} onStatus={mudarStatus} />
          ))}
        </ul>
      )}

      {temMais && !carregando && (
        <div className="mt-6 text-center">
          <Button variant="suave" onClick={() => setLimite((l) => l + POR_PAGINA)}>
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}

function CartaoPedido({ pedido: p, onStatus }: { pedido: Pedido; onStatus: (p: Pedido, s: StatusPedido) => void }) {
  const tel = apenasDigitos(p.cliente_telefone);
  const telWa = tel.length <= 11 ? `55${tel}` : tel;
  const proximo = PROXIMO[p.status];

  return (
    <li className={cn("animate-entrar rounded-card border bg-superficie p-4 sm:p-5", p.status === "novo" ? "border-amarelo/60" : "border-borda")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="titulo text-3xl">#{p.numero}</p>
          <p className="rotulo mt-1 text-suave">{fmtData.format(new Date(p.criado_em))}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={cn("rotulo rounded-full px-3 py-1.5 font-bold", CORES_STATUS[p.status])}>{NOMES_STATUS[p.status]}</span>
          <span className="rotulo rounded-full border border-borda px-2 py-0.5 text-[0.65rem] text-suave">{NOMES_ORIGEM[p.origem ?? "site"]}</span>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 text-sm">
        <p className="text-base font-bold">{p.cliente_nome}</p>
        {tel && (
          <p className="flex items-center gap-2 text-suave">
            <Phone className="size-4" aria-hidden /> {mascararTelefone(tel)}
          </p>
        )}
        <p className="flex items-start gap-2 text-suave">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          {p.tipo === "entrega" ? (
            <span>
              {p.endereco} <span className="text-branco/70">· {p.regiao_nome}</span>
            </span>
          ) : p.tipo === "balcao" ? (
            "Venda no balcão"
          ) : (
            "Retirada na loja"
          )}
        </p>
      </div>

      <ul className="mt-4 space-y-1 border-y border-borda py-3 text-sm">
        {p.itens.map((it, i) => (
          <li key={`${it.produto_id}-${i}`} className="flex justify-between gap-3">
            <span>
              <span className="font-mono font-bold text-rosa">{it.quantidade}x</span> {it.nome}
              {it.opcoes && it.opcoes.length > 0 && (
                <span className="block pl-7 text-suave">+ {it.opcoes.map((o) => o.nome).join(", ")}</span>
              )}
            </span>
            <span className="font-mono text-suave">{formatarPreco(it.preco * it.quantidade)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1 text-sm">
        {p.desconto > 0 && (
          <div className="flex justify-between">
            <dt className="text-suave">Desconto</dt>
            <dd className="font-mono text-sucesso">− {formatarPreco(p.desconto)}</dd>
          </div>
        )}
        {p.taxa > 0 && (
          <div className="flex justify-between">
            <dt className="text-suave">Taxa de entrega</dt>
            <dd className="font-mono">{formatarPreco(p.taxa)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="font-bold">Total</dt>
          <dd className="preco text-lg">{formatarPreco(p.total)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-suave">Pagamento</dt>
          <dd>
            {NOMES_PAGAMENTO[p.pagamento]}
            {p.pagamento === "dinheiro" && (p.troco_para ? ` · troco p/ ${formatarPreco(p.troco_para)}` : " · sem troco")}
          </dd>
        </div>
      </dl>
      {p.observacoes && (
        <p className="mt-3 rounded-xl bg-superficie-2 p-3 text-sm">
          <span className="rotulo mb-1 block text-suave">Obs.</span>
          {p.observacoes}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {proximo && (
          <Button size="sm" onClick={() => onStatus(p, proximo)}>
            Marcar: {NOMES_STATUS[proximo]}
          </Button>
        )}
        {tel && (
        <Button asChild size="sm" variant="whatsapp">
          <a href={`https://wa.me/${telWa}`} target="_blank" rel="noopener noreferrer">
            <IconeWhatsApp /> Cliente
          </a>
        </Button>
        )}
        <label className="sr-only" htmlFor={`status-${p.id}`}>
          Alterar status do pedido {p.numero}
        </label>
        <select
          id={`status-${p.id}`}
          value={p.status}
          onChange={(e) => onStatus(p, e.target.value as StatusPedido)}
          className="h-10 cursor-pointer rounded-full border border-borda bg-superficie-2 px-3 text-sm"
        >
          {(Object.keys(NOMES_STATUS) as StatusPedido[]).map((s) => (
            <option key={s} value={s}>
              {NOMES_STATUS[s]}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
