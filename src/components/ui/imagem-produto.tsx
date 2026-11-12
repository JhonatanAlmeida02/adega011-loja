"use client";

import { useState, type ComponentProps } from "react";
import Image from "next/image";

/** Se o otimizador falhar, tenta o arquivo original uma única vez. */
export function ImagemProduto({ src, alt, onError, unoptimized, ...props }: Omit<ComponentProps<typeof Image>, "src"> & { src: string }) {
  const [origemDireta, setOrigemDireta] = useState<string | null>(null);
  const direto = !!unoptimized || origemDireta === src || src.split("?", 1)[0].endsWith(".svg") || /^(data:|blob:)/.test(src);
  return <Image {...props} src={src} alt={alt} unoptimized={direto} onError={(evento) => {
    if (!direto) setOrigemDireta(src);
    else onError?.(evento);
  }} />;
}
