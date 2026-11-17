"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useConfiguracoes } from "@/lib/admin/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { NOMES_DIAS, horaEmSP, modoEfetivo, prazoDoModo, proximaAberturaEm, proximaHora, quandoEmSP, statusDaLoja } from "@/lib/horario";
import { NOMES_PAGAMENTO, type Configuracoes, type FaixaHorario, type FormaPagamento, type Horarios, type StatusManual } from "@/lib/tipos";
import { apenasDigitos, cn, mascararTelefone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Interruptor } from "@/components/ui/campos";
import { CabecalhoPagina, Carregando, Cartao } from "../ui";

export function PaginaLoja() {
  const { config, gravar } = useConfiguracoes();
  if (!config) return <Carregando />;
  return (
    <>
      <CabecalhoPagina titulo="Loja" descricao="Status, dados de contato, pagamentos e horário." />
      <div className="space-y-6">
        <StatusManualCard config={config} gravar={gravar} />
        <DadosLoja key={config.whatsapp + config.nome} config={config} gravar={gravar} />
        <Pagamentos config={config} gravar={gravar} />
        <EditorHorarios config={config} gravar={gravar} />
      </div>
    </>
  );
}

type Props = { config: Configuracoes; gravar: (c: Partial<Configuracoes>, msg?: string) => Promise<boolean> };

const OPCOES_STATUS: { valor: StatusManual; titulo: string; texto: string }[] = [
  { valor: "auto", titulo: "Automático", texto: "Abre e fecha pelo horário" },
  { valor: "aberta", titulo: "Forçar aberta", texto: "Aceita pedidos até a hora que você escolher" },
  { valor: "fechada", titulo: "Forçar fechada", texto: "Pausa os pedidos" },
];

/** Relógio que anda a cada 30 s (o modo forçado vence sozinho). */
function useAgora() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

function StatusManualCard({ config, gravar }: Props) {
  const agora = useAgora();
  const modo = modoEfetivo(config, agora);
  const prazo = prazoDoModo(config, agora);
  const status = statusDaLoja(config, agora);
  // Modo forçado escolhido, esperando o prazo (ainda não gravado)
  const [escolha, setEscolha] = useState<"aberta" | "fechada" | null>(null);
  const [horaFim, setHoraFim] = useState("");
  const selecionado = escolha ?? modo;

  const abertura = proximaAberturaEm(config.horarios, agora);
  // Pelos horários padrão, a loja estaria fechada agora?
  const fechadaPeloHorario = !statusDaLoja({ ...config, status_manual: "auto", status_ate: null }, agora).aberta;

  const aplicar = async (status_manual: StatusManual, status_ate: Date | null, rotulo: string) => {
    const ok = await gravar({ status_manual, status_ate: status_ate?.toISOString() ?? null }, `Modo: ${rotulo}`);
    if (ok) setEscolha(null);
  };
  // "+2h" a partir de agora, sem os segundos
  const daquiHoras = (horas: number) => new Date(Math.ceil(agora.getTime() / 60_000) * 60_000 + horas * 3_600_000);
  const abrirPor = (horas: number) => {
    const fim = daquiHoras(horas);
    return aplicar("aberta", fim, `Forçar aberta até ${horaEmSP(fim)}`);
  };

  let aviso: string;
  if (modo === "aberta") aviso = prazo ? `Forçada aberta até ${horaEmSP(prazo)}, depois volta ao automático.` : "Forçada aberta sem prazo: só fecha quando você mudar.";
  else if (modo === "fechada") aviso = prazo ? `Pausada até ${quandoEmSP(prazo, agora)}, depois volta ao automático.` : "Fechada até você reabrir.";
  else aviso = "Seguindo os horários de funcionamento.";

  return (
    <Cartao>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="titulo text-3xl">Loja aberta / fechada</h2>
        <span
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-bold",
            status.aberta ? "bg-sucesso/15 text-sucesso" : "bg-rosa/15 text-rosa-texto",
          )}
        >
          {status.titulo} · {status.detalhe}
        </span>
      </div>
      <div role="radiogroup" aria-label="Modo de funcionamento" className="grid gap-3 sm:grid-cols-3">
        {OPCOES_STATUS.map((o) => {
          const sel = selecionado === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => {
                if (o.valor === "auto") {
                  setEscolha(null);
                  void aplicar("auto", null, "Automático");
                } else setEscolha(o.valor);
              }}
              className={cn(
                "min-h-16 cursor-pointer rounded-2xl border-2 px-4 py-3 text-left transition-colors",
                sel ? "border-rosa bg-rosa/10" : "border-borda bg-superficie-2 hover:border-rosa/50",
              )}
            >
              <span className="block font-bold">{o.titulo}</span>
              <span className="text-sm text-suave">{o.texto}</span>
            </button>
          );
        })}
      </div>

      {escolha === "aberta" && (
        <div role="group" aria-label="Até quando fica aberta" className="mt-4 space-y-3 rounded-2xl border border-borda bg-superficie-2 p-4">
          <p className="font-bold">Aberta até quando?</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((h) => (
              <Button key={h} variant="suave" onClick={() => void abrirPor(h)}>
                +{h}h (até {horaEmSP(daquiHoras(h))})
              </Button>
            ))}
            {fechadaPeloHorario && abertura && (
              <Button variant="suave" onClick={() => void aplicar("aberta", abertura, `Forçar aberta até ${horaEmSP(abertura)}`)}>
                Até o horário normal ({quandoEmSP(abertura, agora)})
              </Button>
            )}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!horaFim) return;
              const fim = proximaHora(horaFim, agora);
              void aplicar("aberta", fim, `Forçar aberta até ${horaEmSP(fim)}`);
            }}
          >
            <Campo label="Ou até às" htmlFor="aberta-ate">
              <Input id="aberta-ate" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} className="w-32" />
            </Campo>
            <Button type="submit" disabled={!horaFim}>
              Abrir até essa hora
            </Button>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-suave">Passou da hora, a loja volta sozinha para os horários de funcionamento.</p>
            <Button variant="fantasma" onClick={() => setEscolha(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {escolha === "fechada" && (
        <div role="group" aria-label="Até quando fica fechada" className="mt-4 space-y-3 rounded-2xl border border-borda bg-superficie-2 p-4">
          <p className="font-bold">Fechada até quando?</p>
          <div className="flex flex-wrap gap-2">
            {abertura && (
              <Button variant="suave" onClick={() => void aplicar("fechada", abertura, `Forçar fechada até ${quandoEmSP(abertura, agora)}`)}>
                Até a próxima abertura ({quandoEmSP(abertura, agora)})
              </Button>
            )}
            <Button variant="suave" onClick={() => void aplicar("fechada", null, "Forçar fechada até eu reabrir")}>
              Até eu reabrir (férias, feriado)
            </Button>
            <Button variant="fantasma" onClick={() => setEscolha(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <p className="mt-4 text-sm text-suave" role="status">
        {aviso}
      </p>
    </Cartao>
  );
}

function DadosLoja({ config, gravar }: Props) {
  const [f, setF] = useState({
    nome: config.nome,
    slogan: config.slogan,
    whatsapp: config.whatsapp.replace(/^55/, ""),
    endereco: config.endereco,
    instagram: config.instagram,
    chave_pix: config.chave_pix,
  });
  const [erro, setErro] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const tel = apenasDigitos(f.whatsapp);
    if (tel.length < 10 || tel.length > 11) return setErro("Informe o WhatsApp com DDD, ex.: (11) 91234-5678.");
    setErro("");
    await gravar({
      nome: f.nome.trim() || "Adega011",
      slogan: f.slogan.trim(),
      whatsapp: `55${tel}`,
      endereco: f.endereco.trim(),
      instagram: f.instagram.trim().replace(/^@/, ""),
      chave_pix: f.chave_pix.trim(),
    });
  };

  return (
    <Cartao>
      <h2 className="titulo mb-4 text-3xl">Dados da loja</h2>
      <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nome" htmlFor="l-nome">
          <Input id="l-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={40} />
        </Campo>
        <Campo label="Slogan" htmlFor="l-slogan">
          <Input id="l-slogan" value={f.slogan} onChange={(e) => set("slogan", e.target.value)} maxLength={60} />
        </Campo>
        <Campo label="WhatsApp que recebe os pedidos" htmlFor="l-wa" erro={erro} ajuda="Com DDD. O 55 do Brasil é adicionado sozinho.">
          <Input
            id="l-wa"
            type="tel"
            inputMode="tel"
            value={mascararTelefone(f.whatsapp)}
            onChange={(e) => set("whatsapp", apenasDigitos(e.target.value))}
            aria-invalid={!!erro}
          />
        </Campo>
        <Campo label="Instagram" htmlFor="l-insta">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-suave">@</span>
            <Input id="l-insta" value={f.instagram} onChange={(e) => set("instagram", e.target.value)} className="pl-9" maxLength={40} />
          </div>
        </Campo>
        <Campo label="Endereço" htmlFor="l-end" className="sm:col-span-2">
          <Input id="l-end" value={f.endereco} onChange={(e) => set("endereco", e.target.value)} maxLength={200} />
        </Campo>
        <Campo label="Chave Pix (opcional)" htmlFor="l-pix" ajuda="Mostrada ao cliente depois do pedido com Pix." className="sm:col-span-2">
          <Input id="l-pix" value={f.chave_pix} onChange={(e) => set("chave_pix", e.target.value)} maxLength={100} />
        </Campo>
        <div className="sm:col-span-2">
          <Button type="submit">Salvar dados</Button>
        </div>
      </form>
    </Cartao>
  );
}

function Pagamentos({ config, gravar }: Props) {
  const todas: FormaPagamento[] = ["pix", "cartao", "dinheiro"];
  const alternar = (p: FormaPagamento, v: boolean) => {
    const nova = v ? todas.filter((x) => x === p || config.pagamentos.includes(x)) : config.pagamentos.filter((x) => x !== p);
    if (nova.length === 0) return;
    void gravar({ pagamentos: nova }, "Formas de pagamento salvas");
  };
  return (
    <Cartao>
      <h2 className="titulo mb-2 text-3xl">Formas de pagamento</h2>
      <div className="divide-y divide-borda">
        {todas.map((p) => (
          <div key={p} className="flex min-h-14 items-center justify-between gap-4">
            <span className="font-bold">{NOMES_PAGAMENTO[p]}</span>
            <Interruptor
              checked={config.pagamentos.includes(p)}
              onCheckedChange={(v) => alternar(p, v)}
              label={NOMES_PAGAMENTO[p]}
              disabled={config.pagamentos.length === 1 && config.pagamentos.includes(p)}
            />
          </div>
        ))}
      </div>
      {config.pagamentos.includes("pix") && <PixAutomatico config={config} gravar={gravar} />}
    </Cartao>
  );
}

/** Liga o Pix automático (Mercado Pago). Só liga com as credenciais salvas no Supabase. */
function PixAutomatico({ config, gravar }: Props) {
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  useEffect(() => {
    let ativo = true;
    supabaseNavegador().functions.invoke("pix", { method: "GET" })
      .then(({ data }) => ativo && setConfigurado(!!(data as { configurado?: boolean } | null)?.configurado))
      .catch(() => ativo && setConfigurado(false));
    return () => { ativo = false; };
  }, []);
  const ligado = !!config.pix_online;
  return (
    <div className="mt-3 rounded-2xl border border-borda bg-superficie-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-bold">Pix automático (Mercado Pago)</p>
          <p className="text-sm text-suave">O cliente paga pelo QR Code no site e o pedido chega aqui como pago, sem conferir comprovante.</p>
        </div>
        <Interruptor
          checked={ligado}
          onCheckedChange={(v) => void gravar({ pix_online: v }, v ? "Pix automático ligado" : "Pix automático desligado")}
          label="Pix automático"
          disabled={!ligado && configurado !== true}
        />
      </div>
      {configurado === false && (
        <p role="status" className="mt-2 text-sm text-amarelo-texto">
          Falta salvar as credenciais do Mercado Pago no Supabase (MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET). Veja o README.
        </p>
      )}
    </div>
  );
}

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

function EditorHorarios({ config, gravar }: Props) {
  const [h, setH] = useState<Horarios>(() => structuredClone(config.horarios));
  const mudou = JSON.stringify(h) !== JSON.stringify(config.horarios);

  const atualizar = (dia: number, faixas: FaixaHorario[]) => setH((x) => ({ ...x, [String(dia)]: faixas }));
  const copiarParaTodos = (dia: number) =>
    setH(Object.fromEntries(ORDEM_DIAS.map((d) => [String(d), structuredClone(h[String(dia)] ?? [])])));

  return (
    <Cartao>
      <h2 className="titulo mb-1 text-3xl">Horário de funcionamento</h2>
      <p className="mb-4 text-sm text-suave">
        Horário de São Paulo. Se fechar depois da meia-noite, use por exemplo 16:00 → 02:00.
      </p>
      <ul className="divide-y divide-borda">
        {ORDEM_DIAS.map((dia) => {
          const faixas = h[String(dia)] ?? [];
          return (
            <li key={dia} className="flex flex-wrap items-start gap-3 py-3">
              <div className="flex w-28 items-center gap-3 pt-2.5">
                <Interruptor
                  checked={faixas.length > 0}
                  onCheckedChange={(v) => atualizar(dia, v ? [{ abre: "16:00", fecha: "00:00" }] : [])}
                  label={`Abre ${NOMES_DIAS[dia]}`}
                />
                <span className="font-bold">{NOMES_DIAS[dia].slice(0, 3)}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {faixas.length === 0 && <span className="pt-3 text-suave">Fechado</span>}
                {faixas.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`abre-${dia}-${i}`}>
                      {NOMES_DIAS[dia]} abre às
                    </label>
                    <Input
                      id={`abre-${dia}-${i}`}
                      type="time"
                      value={f.abre}
                      onChange={(e) => atualizar(dia, faixas.map((x, j) => (j === i ? { ...x, abre: e.target.value } : x)))}
                      className="h-11 w-32 font-mono"
                    />
                    <span aria-hidden className="text-suave">→</span>
                    <label className="sr-only" htmlFor={`fecha-${dia}-${i}`}>
                      {NOMES_DIAS[dia]} fecha às
                    </label>
                    <Input
                      id={`fecha-${dia}-${i}`}
                      type="time"
                      value={f.fecha}
                      onChange={(e) => atualizar(dia, faixas.map((x, j) => (j === i ? { ...x, fecha: e.target.value } : x)))}
                      className="h-11 w-32 font-mono"
                    />
                    <Button
                      variant="fantasma"
                      size="icone"
                      aria-label={`Remover faixa de ${NOMES_DIAS[dia]}`}
                      onClick={() => atualizar(dia, faixas.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="fantasma"
                  size="sm"
                  onClick={() => atualizar(dia, [...faixas, { abre: "12:00", fecha: "15:00" }])}
                  aria-label={`Adicionar faixa em ${NOMES_DIAS[dia]}`}
                >
                  <Plus /> Faixa
                </Button>
                {faixas.length > 0 && (
                  <Button variant="fantasma" size="sm" onClick={() => copiarParaTodos(dia)}>
                    Copiar p/ todos
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button disabled={!mudou} onClick={() => gravar({ horarios: h }, "Horário salvo")}>
          Salvar horário
        </Button>
        {mudou && (
          <Button variant="fantasma" onClick={() => setH(structuredClone(config.horarios))}>
            Desfazer
          </Button>
        )}
      </div>
    </Cartao>
  );
}
