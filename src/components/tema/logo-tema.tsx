import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo com a versão certa para cada tema (manual: "rosa em preto" e "preto em branco").
 * As duas imagens vão no HTML e o CSS mostra uma só, então não há troca visível ao carregar.
 */
export function LogoTema({
  escuro,
  claro,
  alt,
  width,
  height,
  className,
  preload,
}: {
  escuro: string;
  claro: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  preload?: boolean;
}) {
  return (
    <>
      <Image src={escuro} alt={alt} width={width} height={height} preload={preload} className={cn("so-escuro", className)} />
      <Image src={claro} alt={alt} width={width} height={height} className={cn("so-claro", className)} />
    </>
  );
}

export const SELO = { escuro: "/logo-selo.svg", claro: "/marca/logo-selo-preto.svg" } as const;
export const SELO_SIMPLES = { escuro: "/marca/logo-selo-simples-rosa.svg", claro: "/marca/logo-selo-simples-preto.svg" } as const;
export const LOGO_HORIZONTAL = { escuro: "/marca/logo-horizontal-rosa.svg", claro: "/marca/logo-horizontal-preto.svg" } as const;
