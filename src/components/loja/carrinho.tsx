"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Bike, CheckCircle2, Copy, MapPin, ShoppingBag, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCarrinho } from "@/lib/carrinho";
import {
  calcularSubtotal,
  calcularTotais,
  cotacaoValida,
  type CotacaoFrete,
  contarItens,
  linkWhatsApp,
  montarLinhas,
  montarMensagem,
  validarCheckout,
  type DadosCheckout,
  type ErrosCheckout,
  type LinhaCarrinho,
} from "@/lib/pedido";
import { atualizarVitrineAposPedido } from "@/app/admin/acoes";
import { abrirWhatsApp, cotarFrete, registrarPedido } from "@/lib/registrar-pedido";
import { controlaSaldo, saldoVendavel, NOMES_PAGAMENTO, type DadosLoja, type FormaPagamento } from "@/lib/tipos";
import { cn, formatarPreco, mascararTelefone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { IconeWhatsApp } from "@/components/marca/icones";
import { SeletorQuantidade } from "./seletor-quantidade";
import { useStatusLoja } from "./use-status-loja";

type Etapa = "itens" | "checkout" | "enviado";

const CHAVE_CLIENTE = "adega011:cliente";

function dadosIniciais(loja: DadosLoja): DadosCheckout {
  const base: DadosCheckout = {
    nome: "",
    telefone: "",
    tipo: loja.config.aceita_entrega ? "entrega" : "retirada",
    regiaoId: "",
    endereco: "",
    bairro: "",
    cidade: loja.config.cidade_padrao,
    complemento: "",
    pagamento: loja.config.pagamentos.length === 1 ? loja.config.pagamentos[0] : "",
    troco: "",
    observacoes: "",
  };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CLIENTE) ?? "{}");
    return { ...base, ...salvo, cidade: salvo.cidade || base.cidade, troco: "", observacoes: "" };
  } catch {
    return base;
  }
}

export function Carrinho({ loja }: { loja: DadosLoja }) {
  const itens = useCarrinho((s) => s.itens);
  const aberto = useCarrinho((s) => s.aberto);
  const setAberto = useCarrinho((s) => s.setAberto);
  const [etapa, setEtapa] = useState<Etapa>("itens");
  const [enviado, setEnviado] = useState<{ numero: number | null; url: string; pix: boolean } | null>(null);

  const linhas = useMemo(() => montarLinhas(itens, loja.produtos), [itens, loja.produtos]);
  const subtotal = calcularSubtotal(linhas);
  const quantidade = contarItens(linhas);

  const mudarAberto = (v: boolean) => {
    setAberto(v);
    if (!v) {
      // Volta para a lista ao fechar (depois da animação).
      setTimeout(() => {
        setEtapa("itens");
        setEnviado(null);
      }, 250);
    }
  };

  return (
    <>
      {quantidade > 0 && !aberto && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-seguro md:inset-x-auto md:right-6 md:bottom-6 md:px-0 md:pb-0">
          <button
            type="button"
            onClick={() => mudarAberto(true)}
            className="pointer-events-auto flex h-14 w-full animate-entrar cursor-pointer items-center gap-3 rounded-full bg-rosa pl-2 pr-6 text-preto shadow-[0_12px_40px_-8px_rgba(255,92,138,0.75)] transition-transform hover:bg-[#ff7a9f] active:scale-[0.98] md:w-auto md:min-w-80"
            aria-label={`Ver carrinho: ${quantidade} ${quantidade === 1 ? "item" : "itens"}, total ${formatarPreco(subtotal)}`}
          >
            <span key={quantidade} className="grid size-10 animate-pulsar place-items-center rounded-full bg-preto font-mono text-lg font-bold text-rosa">
              {quantidade}
            </span>
            <span className="flex-1 text-left text-lg font-bold">Ver carrinho</span>
            <span className="font-mono text-lg font-bold tabular-nums">{formatarPreco(subtotal)}</span>
          </button>
        </div>
      )}

      <Sheet open={aberto} onOpenChange={mudarAberto}>
        <SheetContent rotuloFechar="Fechar carrinho">
          {etapa === "itens" && (
            <EtapaItens
              loja={loja}
              linhas={linhas}
              subtotal={subtotal}
              quantidade={quantidade}
              onContinuar={() => setEtapa("checkout")}
              onFechar={() => mudarAberto(false)}
            />
          )}
          {etapa === "checkout" && (
            <EtapaCheckout
              loja={loja}
              linhas={linhas}
              subtotal={subtotal}
              onVoltar={() => setEtapa("itens")}
              onEnviado={(r) => {
                setEnviado(r);
                setEtapa("enviado");
              }}
            />
          )}
          {etapa === "enviado" && enviado && (
            <EtapaEnviado loja={loja} {...enviado} onNovo={() => mudarAberto(false)} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */

function EtapaItens({
  loja,
  linhas,
  subtotal,
  quantidade,
  onContinuar,
  onFechar,
}: {
  loja: DadosLoja;
  linhas: LinhaCarrinho[];
  subtotal: number;
  quantidade: number;
  onContinuar: () => void;
  onFechar: () => void;
}) {
  const adicionar = useCarrinho((s) => s.adicionar);
  const remover = useCarrinho((s) => s.remover);
  const definir = useCarrinho((s) => s.definir);
  const limpar = useCarrinho((s) => s.limpar);
  const minimo = loja.config.pedido_minimo;
  const falta = Math.max(0, minimo - subtotal);
  const temIndisponivel = linhas.some((l) => l.indisponivel);

  return (
    <>
      <div className="flex items-end gap-3 px-5 pt-4 pr-16 md:px-6 md:pt-6">
        <div>
          <SheetTitle className="titulo text-3xl">Seu pedido</SheetTitle>
          <SheetDescription className="rotulo mt-1 text-suave">
            {quantidade} {quantidade === 1 ? "item" : "itens"}
          </SheetDescription>
        </div>
        {linhas.length > 0 && (
          <button
            type="button"
            onClick={limpar}
            className="ml-auto inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm text-suave hover:bg-superficie-3 hover:text-branco"
          >
            <Trash2 className="size-4" /> Limpar
          </button>
        )}
      </div>

      {linhas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <ShoppingBag className="size-12 text-rosa" aria-hidden />
          <p className="titulo text-3xl">Carrinho vazio</p>
          <p className="text-suave">Bora escolher alguma coisa gelada?</p>
          <Button onClick={onFechar}>Ver cardápio</Button>
        </div>
      ) : (
        <>
          <ul className="mt-4 flex-1 divide-y divide-borda overflow-y-auto px-5 md:px-6">
            {linhas.map((l) => (
              <li key={l.chave} className={cn("flex gap-3 py-4", l.indisponivel && "opacity-70")}>
                <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-superficie-2">
                  {l.produto.foto_url && (
                    <Image src={l.produto.foto_url} alt="" fill sizes="64px" className={cn("object-cover", l.indisponivel && "grayscale")} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">{l.produto.nome}</p>
                  {l.opcoes.length > 0 && (
                    <p className="text-sm text-suave">+ {l.opcoes.map((o) => o.nome).join(", ")}</p>
                  )}
                  {l.indisponivel ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-sm text-perigo">{l.motivo} — não entra no pedido</span>
                      <button
                        type="button"
                        onClick={() => definir(l.chave, 0)}
                        className="cursor-pointer text-sm font-bold text-rosa underline underline-offset-2"
                      >
                        Remover
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="font-mono text-sm text-suave">{formatarPreco(l.unitario)} cada</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <SeletorQuantidade
                          nome={l.produto.nome}
                          quantidade={l.quantidade}
                          maximo={controlaSaldo(l.produto) ? saldoVendavel(l.produto) : undefined}
                          onMais={() => adicionar(l.produto.id, l.opcoes.map((o) => o.id))}
                          onMenos={() => remover(l.chave)}
                          className="w-32"
                        />
                        <span className="preco">{formatarPreco(l.total)}</span>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="pb-seguro border-t border-borda px-5 pt-4 md:px-6">
            {falta > 0 && (
              <div className="mb-4" role="status">
                <div className="flex justify-between text-sm">
                  <span className="text-suave">Pedido mínimo {formatarPreco(minimo)}</span>
                  <span className="font-bold text-amarelo">Faltam {formatarPreco(falta)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-superficie-3">
                  <div
                    className="h-full rounded-full bg-amarelo transition-[width] duration-300"
                    style={{ width: `${Math.min(100, (subtotal / minimo) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-suave">Subtotal</span>
              <span className="preco text-2xl">{formatarPreco(subtotal)}</span>
            </div>
            <p className="mb-4 text-sm text-suave">Taxa de entrega calculada no próximo passo.</p>
            <Button size="lg" className="w-full" disabled={falta > 0 || subtotal === 0} onClick={onContinuar}>
              {temIndisponivel ? "Continuar sem os esgotados" : "Finalizar pedido"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function OpcaoRadio({
  nome,
  valor,
  selecionado,
  onSelecionar,
  children,
  icone,
}: {
  nome: string;
  valor: string;
  selecionado: boolean;
  onSelecionar: () => void;
  children: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-amarelo",
        selecionado ? "border-rosa bg-rosa/10" : "border-borda bg-superficie-2 hover:border-rosa/50",
      )}
    >
      <input type="radio" name={nome} value={valor} checked={selecionado} onChange={onSelecionar} className="sr-only" />
      {icone}
      <span className="flex-1 font-bold">{children}</span>
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full border-2",
          selecionado ? "border-rosa" : "border-suave",
        )}
      >
        {selecionado && <span className="size-2.5 rounded-full bg-rosa" />}
      </span>
    </label>
  );
}

function EtapaCheckout({
  loja,
  linhas,
  subtotal,
  onVoltar,
  onEnviado,
}: {
  loja: DadosLoja;
  linhas: LinhaCarrinho[];
  subtotal: number;
  onVoltar: () => void;
  onEnviado: (r: { numero: number | null; url: string; pix: boolean }) => void;
}) {
  const { config, regioes } = loja;
  const status = useStatusLoja(config);
  const limpar = useCarrinho((s) => s.limpar);
  const [dados, setDados] = useState<DadosCheckout>(() => dadosIniciais(loja));
  const [erros, setErros] = useState<ErrosCheckout>({});
  const [enviando, setEnviando] = useState(false);
  const [cotacao, setCotacao] = useState<CotacaoFrete | null>(null);
  const [cotando, setCotando] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const porDistancia = config.modo_frete === "distancia";
  const regioesAtivas = regioes.filter((r) => r.ativa);
  const totais = calcularTotais(subtotal, dados, regioes, config, cotacao);
  const freteOk = cotacaoValida(cotacao, dados);

  const calcularFrete = async () => {
    const faltando: ErrosCheckout = {};
    if (dados.endereco.trim().length < 5 || !/\d/.test(dados.endereco)) faltando.endereco = "Informe rua e número.";
    if (dados.bairro.trim().length < 2) faltando.bairro = "Informe o bairro.";
    if (faltando.endereco || faltando.bairro) {
      setErros((e) => ({ ...e, ...faltando }));
      return;
    }
    setCotando(true);
    const r = await cotarFrete(dados);
    setCotando(false);
    if (!r.ok) {
      setCotacao(null);
      setErros((e) => ({ ...e, frete: r.mensagem }));
      return;
    }
    setCotacao(r.cotacao);
    setErros((e) => ({ ...e, frete: undefined, endereco: undefined, bairro: undefined }));
  };
  const fechada = status ? !status.aberta : false;

  const set = <K extends keyof DadosCheckout>(k: K, v: DadosCheckout[K]) => {
    setDados((d) => ({ ...d, [k]: v }));
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }));
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (fechada) {
      toast.error(`Loja fechada agora. ${status?.detalhe ?? ""}`);
      return;
    }
    const encontrados = validarCheckout(dados, config, totais);
    setErros(encontrados);
    const chaves = Object.keys(encontrados).filter((k) => encontrados[k as keyof ErrosCheckout]);
    if (chaves.length) {
      const primeiro = chaves.find((k) => k !== "geral");
      if (primeiro) formRef.current?.querySelector<HTMLElement>(`[name="${primeiro}"]`)?.focus();
      toast.error(encontrados.geral ?? "Confira os campos destacados.");
      return;
    }

    // No computador, abre a aba já no clique (evita bloqueio de pop-up após o await).
    const celular = window.matchMedia("(pointer: coarse)").matches;
    const janela = celular ? null : window.open("", "_blank");

    setEnviando(true);
    const r = await registrarPedido(dados, linhas, config, cotacao);
    setEnviando(false);

    if (!r.ok) {
      janela?.close();
      setErros({ geral: r.mensagem });
      toast.error(r.mensagem);
      return;
    }

    // Se o servidor recalculou valores, a mensagem usa os valores dele.
    const totaisFinais =
      r.total !== undefined ? { ...totais, subtotal: r.subtotal!, taxa: r.taxa!, total: r.total } : totais;
    const mensagem = montarMensagem({ config, linhas, dados, totais: totaisFinais, numero: r.numero });
    const url = linkWhatsApp(config.whatsapp, mensagem);

    try {
      const { nome, telefone, tipo, regiaoId, endereco, bairro, cidade, complemento } = dados;
      localStorage.setItem(
        CHAVE_CLIENTE,
        JSON.stringify({ nome, telefone, tipo, regiaoId, endereco, bairro, cidade, complemento }),
      );
    } catch {
      /* sem armazenamento disponível */
    }

    // Atualiza a vitrine (estoque) antes de sair para o WhatsApp; no máximo 1,5 s de espera
    if (linhas.some((l) => controlaSaldo(l.produto))) {
      await Promise.race([atualizarVitrineAposPedido().catch(() => null), new Promise((ok) => setTimeout(ok, 1500))]);
    }
    limpar();
    onEnviado({ numero: r.numero, url, pix: dados.pagamento === "pix" });
    abrirWhatsApp(url, janela);
  };

  return (
    <form ref={formRef} onSubmit={enviar} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pr-16 md:px-4 md:pt-5">
        <Button type="button" variant="fantasma" size="icone" onClick={onVoltar} aria-label="Voltar para o carrinho">
          <ArrowLeft />
        </Button>
        <div>
          <SheetTitle className="titulo text-3xl">Finalizar pedido</SheetTitle>
          <SheetDescription className="sr-only">Preencha seus dados para enviar o pedido pelo WhatsApp</SheetDescription>
        </div>
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-5 pt-4 pb-6 md:px-6">
        {fechada && (
          <p role="alert" className="rounded-2xl border border-rosa/50 bg-rosa/10 p-4 text-sm">
            <strong className="text-rosa">Loja fechada agora.</strong> {status?.detalhe}. Você pode montar o pedido e enviar
            quando abrirmos.
          </p>
        )}

        <fieldset className="space-y-4">
          <legend className="titulo mb-3 text-2xl">Seus dados</legend>
          <Campo label="Nome" htmlFor="nome" erro={erros.nome}>
            <Input
              id="nome"
              name="nome"
              autoComplete="name"
              value={dados.nome}
              onChange={(e) => set("nome", e.target.value)}
              aria-invalid={!!erros.nome}
              aria-describedby={erros.nome ? "nome-erro" : undefined}
              maxLength={80}
              required
            />
          </Campo>
          <Campo label="WhatsApp / telefone" htmlFor="telefone" erro={erros.telefone}>
            <Input
              id="telefone"
              name="telefone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(11) 91234-5678"
              value={mascararTelefone(dados.telefone)}
              onChange={(e) => set("telefone", e.target.value)}
              aria-invalid={!!erros.telefone}
              aria-describedby={erros.telefone ? "telefone-erro" : undefined}
              required
            />
          </Campo>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="titulo mb-3 text-2xl">Como quer receber?</legend>
          <div className="grid grid-cols-2 gap-3">
            {config.aceita_entrega && (
              <OpcaoRadio
                nome="tipo"
                valor="entrega"
                selecionado={dados.tipo === "entrega"}
                onSelecionar={() => set("tipo", "entrega")}
                icone={<Bike className="size-5 text-rosa" aria-hidden />}
              >
                Entrega
              </OpcaoRadio>
            )}
            {config.aceita_retirada && (
              <OpcaoRadio
                nome="tipo"
                valor="retirada"
                selecionado={dados.tipo === "retirada"}
                onSelecionar={() => set("tipo", "retirada")}
                icone={<Store className="size-5 text-rosa" aria-hidden />}
              >
                Retirada
              </OpcaoRadio>
            )}
          </div>
          {erros.tipo && <p role="alert" className="text-sm text-perigo">{erros.tipo}</p>}

          {dados.tipo === "entrega" ? (
            <div className="space-y-4 pt-1">
              {porDistancia ? (
                <>
                  <Campo label="Rua e número" htmlFor="endereco" erro={erros.endereco}>
                    <Input
                      id="endereco"
                      name="endereco"
                      autoComplete="address-line1"
                      placeholder="Ex.: Rua das Flores, 120"
                      value={dados.endereco}
                      onChange={(e) => set("endereco", e.target.value)}
                      aria-invalid={!!erros.endereco}
                      aria-describedby={erros.endereco ? "endereco-erro" : undefined}
                      maxLength={150}
                      required
                    />
                  </Campo>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Bairro" htmlFor="bairro" erro={erros.bairro}>
                      <Input
                        id="bairro"
                        name="bairro"
                        autoComplete="address-level3"
                        value={dados.bairro}
                        onChange={(e) => set("bairro", e.target.value)}
                        aria-invalid={!!erros.bairro}
                        aria-describedby={erros.bairro ? "bairro-erro" : undefined}
                        maxLength={80}
                        required
                      />
                    </Campo>
                    <Campo label="Cidade" htmlFor="cidade">
                      <Input
                        id="cidade"
                        name="cidade"
                        autoComplete="address-level2"
                        value={dados.cidade}
                        onChange={(e) => set("cidade", e.target.value)}
                        maxLength={80}
                      />
                    </Campo>
                  </div>
                  <div className="rounded-2xl border border-borda bg-superficie-2 p-4" aria-live="polite">
                    {freteOk && cotacao ? (
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">
                            {cotacao.km.toFixed(1).replace(".", ",")} km · <span className="preco">{formatarPreco(cotacao.taxa)}</span>
                          </p>
                          <p className="mt-1 text-sm text-suave">Entrega em: {cotacao.endereco_formatado}</p>
                        </div>
                        <Button type="button" variant="fantasma" size="sm" onClick={calcularFrete} disabled={cotando}>
                          Recalcular
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="contorno"
                          className="w-full"
                          onClick={calcularFrete}
                          disabled={cotando}
                          name="frete"
                        >
                          <MapPin /> {cotando ? "Calculando…" : "Calcular entrega"}
                        </Button>
                        <p className="mt-2 text-center text-xs text-suave">
                          {formatarPreco(config.taxa_base)} + {formatarPreco(config.taxa_por_km)} por km rodado
                        </p>
                      </>
                    )}
                    {erros.frete && (
                      <p role="alert" className="mt-2 text-sm text-perigo">
                        {erros.frete}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
              <Campo label="Região / bairro" htmlFor="regiaoId" erro={erros.regiaoId}>
                <Select
                  id="regiaoId"
                  name="regiaoId"
                  value={dados.regiaoId}
                  onChange={(e) => set("regiaoId", e.target.value)}
                  aria-invalid={!!erros.regiaoId}
                  aria-describedby={erros.regiaoId ? "regiaoId-erro" : undefined}
                  required
                >
                  <option value="">Selecione…</option>
                  {regioesAtivas.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome} — {r.taxa ? formatarPreco(r.taxa) : "Grátis"}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo label="Endereço (rua e número)" htmlFor="endereco" erro={erros.endereco}>
                <Input
                  id="endereco"
                  name="endereco"
                  autoComplete="street-address"
                  value={dados.endereco}
                  onChange={(e) => set("endereco", e.target.value)}
                  aria-invalid={!!erros.endereco}
                  aria-describedby={erros.endereco ? "endereco-erro" : undefined}
                  maxLength={200}
                  required
                />
              </Campo>
                </>
              )}
              <Campo label="Complemento / referência (opcional)" htmlFor="complemento">
                <Input
                  id="complemento"
                  name="complemento"
                  placeholder="Apto, bloco, ponto de referência"
                  value={dados.complemento}
                  onChange={(e) => set("complemento", e.target.value)}
                  maxLength={100}
                />
              </Campo>
            </div>
          ) : (
            <p className="rounded-2xl border border-borda bg-superficie-2 p-4 text-sm">
              <span className="rotulo mb-1 block text-suave">Retire em</span>
              {config.endereco || "Endereço da loja"}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="titulo mb-3 text-2xl">Pagamento</legend>
          <div className="grid gap-3">
            {config.pagamentos.map((p: FormaPagamento) => (
              <OpcaoRadio
                key={p}
                nome="pagamento"
                valor={p}
                selecionado={dados.pagamento === p}
                onSelecionar={() => set("pagamento", p)}
              >
                {NOMES_PAGAMENTO[p]}
              </OpcaoRadio>
            ))}
          </div>
          {erros.pagamento && <p role="alert" className="text-sm text-perigo">{erros.pagamento}</p>}
          {dados.pagamento === "dinheiro" && (
            <Campo
              label="Troco para quanto?"
              htmlFor="troco"
              erro={erros.troco}
              ajuda="Deixe em branco se não precisar de troco."
              className="pt-1"
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-suave">R$</span>
                <Input
                  id="troco"
                  name="troco"
                  inputMode="decimal"
                  placeholder="100,00"
                  value={dados.troco}
                  onChange={(e) => set("troco", e.target.value.replace(/[^\d,.]/g, ""))}
                  aria-invalid={!!erros.troco}
                  aria-describedby={erros.troco ? "troco-erro" : undefined}
                  className="pl-12 font-mono"
                />
              </div>
            </Campo>
          )}
        </fieldset>

        <Campo label="Observações (opcional)" htmlFor="observacoes">
          <Textarea
            id="observacoes"
            name="observacoes"
            placeholder="Ex.: sem gelo, tocar o interfone 12…"
            value={dados.observacoes}
            onChange={(e) => set("observacoes", e.target.value)}
            maxLength={500}
          />
        </Campo>
      </div>

      <div className="pb-seguro border-t border-borda bg-superficie px-5 pt-4 md:px-6">
        <dl className="mb-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-suave">Subtotal</dt>
            <dd className="font-mono">{formatarPreco(totais.subtotal)}</dd>
          </div>
          {dados.tipo === "entrega" && (
            <div className="flex justify-between">
              <dt className="text-suave">Taxa de entrega{totais.km != null && ` (${totais.km.toFixed(1).replace(".", ",")} km)`}</dt>
              <dd className="font-mono" aria-live="polite">
                {totais.taxaDefinida
                  ? totais.taxa
                    ? formatarPreco(totais.taxa)
                    : "Grátis"
                  : porDistancia
                    ? "Calcule acima"
                    : "Escolha a região"}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-bold">Total</dt>
            <dd className="preco text-2xl" aria-live="polite" data-testid="total">
              {formatarPreco(totais.total)}
            </dd>
          </div>
        </dl>
        {erros.geral && (
          <p role="alert" className="mb-3 text-sm text-perigo">
            {erros.geral}
          </p>
        )}
        <Button type="submit" variant="whatsapp" size="lg" className="w-full" disabled={enviando || fechada}>
          <IconeWhatsApp />
          {enviando ? "Enviando…" : fechada ? "Loja fechada" : "Enviar pedido pelo WhatsApp"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function EtapaEnviado({
  loja,
  numero,
  url,
  pix,
  onNovo,
}: {
  loja: DadosLoja;
  numero: number | null;
  url: string;
  pix: boolean;
  onNovo: () => void;
}) {
  const chave = loja.config.chave_pix;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <CheckCircle2 className="size-16 animate-pulsar text-sucesso" aria-hidden />
      <SheetTitle className="titulo text-3xl">{numero ? `Pedido #${numero} pronto!` : "Pedido pronto!"}</SheetTitle>
      <SheetDescription className="max-w-xs text-suave">
        Abrimos o WhatsApp com tudo preenchido. É só tocar em <strong className="text-branco">enviar</strong> por lá.
      </SheetDescription>
      {pix && chave && (
        <div className="w-full max-w-xs rounded-2xl border border-borda bg-superficie-2 p-4 text-left">
          <p className="rotulo text-suave">Chave Pix</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-amarelo">{chave}</code>
            <Button
              type="button"
              size="icone-sm"
              variant="suave"
              aria-label="Copiar chave Pix"
              onClick={() => navigator.clipboard?.writeText(chave).then(() => toast.success("Chave Pix copiada"))}
            >
              <Copy />
            </Button>
          </div>
        </div>
      )}
      <Button asChild variant="whatsapp" size="lg" className="w-full max-w-xs">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <IconeWhatsApp /> Abrir WhatsApp de novo
        </a>
      </Button>
      <Button variant="fantasma" onClick={onNovo}>
        Fazer outro pedido
      </Button>
    </div>
  );
}
