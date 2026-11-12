"use client";

import { useContext, useState, type ComponentProps } from "react";
import Image from "next/image";
import { FotosPreparadasContext } from "./fotos-preparadas";

/** Se o otimizador falhar, tenta o arquivo original uma única vez. */
export function ImagemProduto({ src, alt, onError, unoptimized, ...props }: Omit<ComponentProps<typeof Image>, "src"> & { src: string }) {
  const [origemDireta, setOrigemDireta] = useState<string | null>(null);
  const fotos = useContext(FotosPreparadasContext);
  const direto = !!unoptimized || origemDireta === src || src.split("?", 1)[0].endsWith(".svg") || /^(data:|blob:)/.test(src);
  const pronta = !direto ? fotos[src] : undefined;
  if (pronta) return <picture>
    <source type="image/webp" srcSet={pronta.srcSet} sizes={props.sizes} />
    <Image {...props} src={pronta.src} alt={alt} unoptimized onError={() => setOrigemDireta(src)} />
  </picture>;
  return <Image {...props} src={src} alt={alt} unoptimized={direto} onError={(evento) => {
    if (!direto) setOrigemDireta(src);
    else onError?.(evento);
  }} />;
}
