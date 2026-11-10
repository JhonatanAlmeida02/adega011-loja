"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";

const CHAVE = "adega011:maior-de-idade";

const semAssinatura = () => () => {};
const lerConfirmacao = () => {
  try {
    return localStorage.getItem(CHAVE) === "sim";
  } catch {
    return false;
  }
};

/** Pergunta a idade na primeira visita (venda de bebida alcoólica). */
export function VerificacaoIdade() {
  // No servidor assume "confirmado" (não renderiza o modal); no navegador lê o localStorage.
  const jaConfirmado = useSyncExternalStore(semAssinatura, lerConfirmacao, () => true);
  const [confirmadoAgora, setConfirmadoAgora] = useState(false);
  const [negado, setNegado] = useState(false);
  const aberto = !jaConfirmado && !confirmadoAgora;

  const confirmar = () => {
    try {
      localStorage.setItem(CHAVE, "sim");
    } catch {
      /* navegação privada: pergunta de novo na próxima visita */
    }
    setConfirmadoAgora(true);
  };

  return (
    <Dialog.Root open={aberto}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-preto/95 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-x-4 top-1/2 z-[60] mx-auto max-w-sm -translate-y-1/2 animate-entrar rounded-[1.75rem] border border-borda bg-superficie p-7 text-center shadow-2xl outline-none"
        >
          <Image src="/logo-selo.svg" alt="" width={88} height={88} className="mx-auto" />
          {negado ? (
            <>
              <Dialog.Title className="titulo mt-5 text-4xl">Volte depois!</Dialog.Title>
              <Dialog.Description className="mt-3 text-suave">
                A venda de bebidas alcoólicas é proibida para menores de 18 anos.
              </Dialog.Description>
              <Button variant="suave" className="mt-6 w-full" onClick={() => setNegado(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <>
              <Dialog.Title className="titulo mt-5 text-4xl">Você tem 18 anos ou mais?</Dialog.Title>
              <Dialog.Description className="mt-3 text-suave">
                Pra entrar na Adega011 precisamos confirmar sua idade.
              </Dialog.Description>
              <div className="mt-6 flex flex-col gap-3">
                <Button size="lg" onClick={confirmar} autoFocus>
                  Sim, tenho 18+
                </Button>
                <Button size="lg" variant="fantasma" onClick={() => setNegado(true)}>
                  Não tenho
                </Button>
              </div>
              <p className="rotulo mt-5 text-[0.68rem] text-suave">Beba com moderação · Se beber, não dirija</p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
