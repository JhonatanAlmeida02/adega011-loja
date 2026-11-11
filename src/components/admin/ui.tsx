"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import { AlertDialog } from "radix-ui";
import { ImagePlus, Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { importarImagemPorLink } from "@/app/admin/acoes";
import { enviarImagem } from "@/lib/admin/imagens";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Interruptor } from "@/components/ui/campos";

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-bold text-2xl">{titulo}</h1>
        {descricao && <p className="mt-1 text-xs text-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

export function Cartao({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-card border border-borda bg-superficie p-3 sm:p-4", className)} {...props}>
      {children}
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-suave">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {texto}
    </div>
  );
}

export function Vazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-borda px-6 py-14 text-center">
      <p className="titulo text-3xl">{titulo}</p>
      {texto && <p className="mx-auto mt-2 max-w-sm text-suave">{texto}</p>}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

/** Linha com rótulo + interruptor, área de toque grande. */
export function LinhaInterruptor({
  rotulo,
  descricao,
  checked,
  onChange,
  disabled,
}: {
  rotulo: string;
  descricao?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block font-bold">{rotulo}</span>
        {descricao && <span className="block text-sm text-suave">{descricao}</span>}
      </label>
      <Interruptor id={id} checked={checked} onCheckedChange={onChange} label={rotulo} disabled={disabled} />
    </div>
  );
}

/** Diálogo de confirmação acessível (Radix AlertDialog). */
export function Confirmar({
  titulo,
  descricao,
  rotuloConfirmar = "Excluir",
  onConfirmar,
  children,
}: {
  titulo: string;
  descricao?: string;
  rotuloConfirmar?: string;
  onConfirmar: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-[fade-in_0.15s_ease-out]" />
        <AlertDialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 animate-entrar rounded-[1.5rem] border border-borda bg-superficie p-6 shadow-2xl">
          <AlertDialog.Title className="titulo text-3xl">{titulo}</AlertDialog.Title>
          {descricao && <AlertDialog.Description className="mt-2 text-suave">{descricao}</AlertDialog.Description>}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="suave">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="perigo" onClick={() => void onConfirmar()}>
                {rotuloConfirmar}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Seleção + upload de imagem com pré-visualização. */
export function UploadImagem({
  valor,
  onChange,
  pasta,
  proporcao = "aspect-square",
  rotulo = "Foto",
}: {
  valor: string | null;
  onChange: (url: string | null) => void;
  pasta: "produtos" | "banner";
  proporcao?: string;
  rotulo?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [modoLink, setModoLink] = useState(false);
  const [link, setLink] = useState("");
  const [erroLink, setErroLink] = useState("");
  const id = useId();

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviando(true);
    try {
      onChange(await enviarImagem(arquivo, pasta));
      toast.success("Imagem enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };

  const importar = async () => {
    if (!link.trim()) return setErroLink("Cole o link da imagem.");
    setErroLink("");
    setEnviando(true);
    const r = await importarImagemPorLink(link.trim(), pasta);
    setEnviando(false);
    if (!r.ok) return setErroLink(r.erro);
    onChange(r.url);
    setLink("");
    setModoLink(false);
    toast.success("Imagem importada");
  };

  return (
    <div>
      <span className="rotulo mb-2 block text-suave" id={`${id}-rotulo`}>
        {rotulo}
      </span>
      <div className={cn("relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-borda bg-superficie-2", proporcao)}>
        {valor ? (
          <Image src={valor} alt="Pré-visualização" fill sizes="(min-width: 768px) 400px, 100vw" className="object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 text-suave hover:text-texto"
          >
            <ImagePlus className="size-8" aria-hidden />
            <span className="text-sm">Toque para escolher uma imagem</span>
          </button>
        )}
        {enviando && (
          <div className="absolute inset-0 grid place-items-center bg-preto/70" role="status">
            <Loader2 className="size-8 animate-spin text-rosa-texto" aria-label="Enviando imagem" />
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-labelledby={`${id}-rotulo`}
        onChange={(e) => void escolher(e.target.files?.[0])}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="suave" size="sm" onClick={() => input.current?.click()} disabled={enviando}>
          <ImagePlus /> {valor ? "Trocar foto" : "Escolher foto"}
        </Button>
        <Button
          type="button"
          variant={modoLink ? "contorno" : "suave"}
          size="sm"
          onClick={() => setModoLink((v) => !v)}
          disabled={enviando}
          aria-expanded={modoLink}
          aria-controls={`${id}-link`}
        >
          <Link2 /> Colar link
        </Button>
        {valor && (
          <Button type="button" variant="fantasma" size="sm" onClick={() => onChange(null)} disabled={enviando}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>
      {modoLink && (
        <div id={`${id}-link`} className="mt-3 rounded-2xl border border-borda bg-superficie-2 p-3">
          <label htmlFor={`${id}-url`} className="rotulo mb-2 block text-suave">
            Link da imagem
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              placeholder="https://…/foto.jpg"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                // Enter importa a imagem em vez de enviar o formulário do produto
                if (e.key === "Enter") {
                  e.preventDefault();
                  void importar();
                }
              }}
              aria-invalid={!!erroLink}
              aria-describedby={`${id}-ajuda`}
              autoFocus
            />
            <Button type="button" onClick={() => void importar()} disabled={enviando || !link.trim()} className="shrink-0">
              Importar
            </Button>
          </div>
          <p id={`${id}-ajuda`} role={erroLink ? "alert" : undefined} className={cn("mt-2 text-sm", erroLink ? "text-perigo" : "text-suave")}>
            {erroLink ||
              "Na foto, clique com o botão direito (ou segure no celular) e escolha “Copiar endereço da imagem”. Use só imagens que você tem direito de usar."}
          </p>
        </div>
      )}
    </div>
  );
}
