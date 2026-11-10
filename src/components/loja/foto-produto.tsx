import Image from "next/image";
import { cn } from "@/lib/utils";

/** Foto do produto com lazy loading e fallback com o selo quando não houver imagem. */
export function FotoProduto({
  src,
  alt,
  sizes,
  className,
  esgotado,
  carregarJa,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  className?: string;
  esgotado?: boolean;
  carregarJa?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-superficie-2", className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          loading={carregarJa ? "eager" : "lazy"}
          className={cn(
            "object-cover transition-transform duration-500 group-hover:scale-[1.04]",
            esgotado && "grayscale opacity-60",
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Image src="/marca/logo-selo-simples-rosa.svg" alt="" width={72} height={72} className="opacity-40" />
        </div>
      )}
    </div>
  );
}
