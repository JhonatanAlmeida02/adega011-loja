import Image from "next/image";
import { ArrowDown } from "lucide-react";
import type { Configuracoes } from "@/lib/tipos";
import { LinhasRuaBanner, Padrao011 } from "@/components/marca/grafismos";

export function Banner({ config }: { config: Configuracoes }) {
  const temImagem = Boolean(config.banner_imagem_url);
  const link = config.banner_botao_link || "#cardapio";
  const externo = /^https?:\/\//.test(link);

  return (
    <section aria-label="Destaque" className="mx-auto w-full max-w-6xl px-4">
      <div className="tema-escuro relative isolate flex min-h-[240px] flex-col justify-end overflow-hidden rounded-[1.25rem] border border-borda bg-superficie p-5 sm:min-h-[280px] sm:p-7 lg:min-h-[300px]">
        {temImagem ? (
          <>
            <Image
              src={config.banner_imagem_url!}
              alt=""
              fill
              preload
              sizes="(min-width: 1152px) 1120px, 100vw"
              className="-z-20 object-cover"
            />
            {/* Gradiente garante contraste do texto sobre qualquer foto */}
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-preto via-preto/70 to-preto/10" />
          </>
        ) : (
          <div aria-hidden className="absolute inset-0 -z-10">
            <Padrao011 opacidade={0.05} />
            <LinhasRuaBanner className="absolute inset-0 h-full w-full opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-superficie via-superficie/60 to-transparent" />
          </div>
        )}

        <p className="rotulo mb-2 text-[.65rem] inline-flex w-fit items-center gap-2 rounded-full bg-preto/70 px-2.5 py-1 text-amarelo-texto">
          <span aria-hidden className="size-1.5 rounded-full bg-amarelo" /> 011 · São Paulo
        </p>
        <h1 className="titulo max-w-3xl text-[2.5rem] sm:text-5xl lg:text-6xl">{config.banner_titulo}</h1>
        {config.banner_texto && (
          <p className="mt-2 max-w-lg text-sm text-texto/90 sm:text-base">{config.banner_texto}</p>
        )}
        {config.banner_botao_texto && (
          <a
            href={link}
            {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="mt-4 inline-flex h-10 [@media(pointer:coarse)]:min-h-11 w-fit items-center gap-2 rounded-full bg-rosa px-5 text-sm font-bold text-preto shadow-[0_10px_30px_-10px_var(--acao-brilho)] transition-transform hover:bg-rosa-hover active:scale-[0.97]"
          >
            {config.banner_botao_texto}
            {!externo && <ArrowDown aria-hidden className="size-4" />}
          </a>
        )}
      </div>
    </section>
  );
}
