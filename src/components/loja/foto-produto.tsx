import Image from "next/image";
import { LogoTema, SELO_SIMPLES } from "@/components/tema/logo-tema";
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
          <LogoTema {...SELO_SIMPLES} alt="" width={72} height={72} className="opacity-40" />
        </div>
      )}
    </div>
  );
}

/**
 * Miniatura quadrada de tamanho fixo: a foto aparece inteira (reduzida, sem
 * cortar) sobre fundo branco; sem foto, o selo da marca bem clarinho.
 */
export function MiniaturaFoto({ src, alt = "", sizes = "56px", className }: { src: string | null; alt?: string; sizes?: string; className?: string }) {
  return (
    <span
      className={cn(
        "relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-borda",
        src ? "bg-white" : "bg-superficie-3",
        className,
      )}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} className="object-contain p-1.5" />
      ) : (
        <LogoTema {...SELO_SIMPLES} alt="" width={40} height={40} className="w-[55%] opacity-25" />
      )}
    </span>
  );
}
