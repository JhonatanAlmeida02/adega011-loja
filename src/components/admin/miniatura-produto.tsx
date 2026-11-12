"use client";

import { useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

/** Imagem decorativa: o nome do produto já aparece ao lado. */
export function MiniaturaProduto({ foto, tamanho = 32 }: { foto?: string | null; tamanho?: 32 | 40 }) {
  const [fotoComErro, setFotoComErro] = useState<string | null>(null);
  return <span aria-hidden className={cn(
    "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-borda bg-superficie-2 text-suave",
    tamanho === 40 ? "size-10" : "size-8",
  )}>
    {foto && foto !== fotoComErro
      ? <Image src={foto} alt="" fill sizes={`${tamanho}px`} className="object-contain" onError={() => setFotoComErro(foto)} />
      : <Package className={tamanho === 40 ? "size-5" : "size-4"} />}
  </span>;
}
