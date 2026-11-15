"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Copy, Loader2, QrCode, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { conferirPix, gerarPix, lerStatusPix, tempoRestante, type StatusPix } from "@/lib/pix";
import { formatarPreco } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { IconeWhatsApp } from "@/components/marca/icones";

/**
 * Pix automático: mostra o QR Code do pedido e espera o Mercado Pago confirmar.
 * Quem confirma é o servidor (aviso do Mercado Pago conferido no banco); esta
 * tela só pergunta "já pagou?" de tempos em tempos.
 */
export function PagamentoPix({
  pedidoId,
  numero,
  urlPago,
  chavePix,
  urlSemPix,
  onNovo,
}: {
  pedidoId: string;
  numero: number | null;
  /** WhatsApp com a mensagem "Pix pago" */
  urlPago: string;
  /** Plano B se o Pix automático falhar */
  chavePix: string;
  urlSemPix: string;
  onNovo: () => void;
}) {
  const [fase, setFase] = useState<"gerando" | "erro" | "aguardando" | "pago" | "vencido">("gerando");
  const [erro, setErro] = useState("");
  const [pix, setPix] = useState<StatusPix | null>(null);
  // Hora do servidor (aparelho com relógio errado não muda a contagem)
  const diferenca = useRef(0);
  const [agora, setAgora] = useState(() => Date.now());
  const voltas = useRef(0);

  // Gera (ou recupera) a cobrança
  useEffect(() => {
    let ativo = true;
    void (async () => {
      const r = await gerarPix(pedidoId);
      if (!ativo) return;
      if (!r.ok) {
        setErro(r.mensagem);
        setFase("erro");
        return;
      }
      const st = await lerStatusPix(pedidoId);
      if (!ativo) return;
      if (!st) {
        setErro("Não foi possível gerar o Pix agora.");
        setFase("erro");
        return;
      }
      diferenca.current = st.diferencaRelogio;
      setAgora(Date.now() + st.diferencaRelogio);
      setPix(st);
      setFase(st.status === "pago" ? "pago" : st.status === "pendente" ? "aguardando" : "vencido");
    })();
    return () => {
      ativo = false;
    };
  }, [pedidoId]);

  // Enquanto aguarda: relógio, consulta a cada 3 s e, a cada ~15 s, pede para conferir no Mercado Pago
  useEffect(() => {
    if (fase !== "aguardando") return;
    const relogio = setInterval(() => setAgora(Date.now() + diferenca.current), 1000);
    const consulta = setInterval(async () => {
      voltas.current++;
      if (voltas.current % 5 === 0) await conferirPix(pedidoId);
      const st = await lerStatusPix(pedidoId);
      if (!st) return;
      diferenca.current = st.diferencaRelogio;
      setPix((anterior) => ({ ...st, qr_code: st.qr_code ?? anterior?.qr_code ?? null, qr_code_base64: st.qr_code_base64 ?? anterior?.qr_code_base64 ?? null }));
      if (st.status === "pago") {
        setFase("pago");
        toast.success("Pagamento confirmado!");
      } else if (st.status !== "pendente") setFase("vencido");
    }, 3000);
    return () => {
      clearInterval(relogio);
      clearInterval(consulta);
    };
  }, [fase, pedidoId]);

  const venceu = fase === "aguardando" && pix && new Date(pix.expira_em).getTime() <= agora;
  const titulo = numero ? `Pedido #${numero}` : "Seu pedido";

  if (fase === "gerando") {
    return (
      <Centro>
        <Loader2 className="size-12 animate-spin text-rosa-texto" aria-hidden />
        <SheetTitle className="titulo text-3xl">Gerando seu Pix…</SheetTitle>
        <SheetDescription className="text-suave">Só um instante.</SheetDescription>
      </Centro>
    );
  }

  if (fase === "pago") {
    return (
      <Centro>
        <CheckCircle2 className="size-16 animate-pulsar text-sucesso" aria-hidden />
        <SheetTitle className="titulo text-3xl">Pagamento confirmado!</SheetTitle>
        <SheetDescription className="max-w-xs text-suave">
          {titulo} está pago e já chegou na adega. Se quiser, avise pelo WhatsApp.
        </SheetDescription>
        <Button asChild variant="whatsapp" size="lg" className="w-full max-w-xs">
          <a href={urlPago} target="_blank" rel="noopener noreferrer">
            <IconeWhatsApp /> Avisar no WhatsApp
          </a>
        </Button>
        <Button variant="fantasma" onClick={onNovo}>
          Fazer outro pedido
        </Button>
      </Centro>
    );
  }

  if (fase === "vencido" || venceu) {
    return (
      <Centro>
        <Clock className="size-14 text-suave" aria-hidden />
        <SheetTitle className="titulo text-3xl">O Pix venceu</SheetTitle>
        <SheetDescription className="max-w-xs text-suave">
          Não recebemos o pagamento a tempo e o pedido foi cancelado. Se você pagou, chame no WhatsApp que a gente resolve.
        </SheetDescription>
        <Button asChild variant="whatsapp" size="lg" className="w-full max-w-xs">
          <a href={urlSemPix} target="_blank" rel="noopener noreferrer">
            <IconeWhatsApp /> Falar no WhatsApp
          </a>
        </Button>
        <Button variant="fantasma" onClick={onNovo}>
          Fazer o pedido de novo
        </Button>
      </Centro>
    );
  }

  if (fase === "erro" || !pix) {
    return (
      <Centro>
        <TriangleAlert className="size-14 text-amarelo-texto" aria-hidden />
        <SheetTitle className="titulo text-3xl">{titulo} registrado</SheetTitle>
        <SheetDescription className="max-w-xs text-suave">
          {erro || "Não foi possível gerar o Pix agora."} Você pode pagar pela chave Pix e mandar o comprovante no WhatsApp.
        </SheetDescription>
        {chavePix && <ChavePix chave={chavePix} />}
        <Button asChild variant="whatsapp" size="lg" className="w-full max-w-xs">
          <a href={urlSemPix} target="_blank" rel="noopener noreferrer">
            <IconeWhatsApp /> Enviar pedido pelo WhatsApp
          </a>
        </Button>
        <Button variant="fantasma" onClick={onNovo}>
          Fazer outro pedido
        </Button>
      </Centro>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-8 text-center">
      <QrCode className="size-10 text-rosa-texto" aria-hidden />
      <SheetTitle className="titulo text-3xl">Pague com Pix</SheetTitle>
      <SheetDescription className="text-suave">
        {titulo} · <strong className="preco text-texto">{formatarPreco(pix.valor)}</strong>
      </SheetDescription>

      {pix.qr_code_base64 && (
        // QR em base64 vindo do Mercado Pago; fundo branco para qualquer leitor
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${pix.qr_code_base64}`}
          alt={`QR Code Pix de ${formatarPreco(pix.valor)}`}
          width={220}
          height={220}
          className="size-56 rounded-2xl bg-white p-3"
        />
      )}

      {pix.qr_code && (
        <div className="w-full max-w-xs space-y-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => navigator.clipboard?.writeText(pix.qr_code!).then(() => toast.success("Código Pix copiado"))}
          >
            <Copy /> Copiar código Pix
          </Button>
          <p className="break-all rounded-xl border border-borda bg-superficie-2 p-2 font-mono text-[0.65rem] leading-snug text-suave" aria-label="Código Pix copia e cola">
            {pix.qr_code}
          </p>
        </div>
      )}

      <ol className="w-full max-w-xs space-y-1 text-left text-sm text-suave">
        <li>1. Abra o app do seu banco e escolha <strong className="text-texto">Pix</strong>.</li>
        <li>2. Leia o QR Code ou use <strong className="text-texto">Pix copia e cola</strong>.</li>
        <li>3. Pague. A confirmação aparece aqui sozinha.</li>
      </ol>

      <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-rosa-texto" aria-hidden />
        Aguardando pagamento · vence em <span className="font-mono tabular-nums">{tempoRestante(pix.expira_em, agora)}</span>
      </p>
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">{children}</div>;
}

function ChavePix({ chave }: { chave: string }) {
  return (
    <div className="w-full max-w-xs rounded-2xl border border-borda bg-superficie-2 p-4 text-left">
      <p className="rotulo text-suave">Chave Pix</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 break-all font-mono text-amarelo-texto">{chave}</code>
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
  );
}
