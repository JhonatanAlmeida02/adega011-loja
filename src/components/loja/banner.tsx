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
      <div className="relative isolate flex min-h-[340px] flex-col justify-end overflow-hidden rounded-[1.75rem] border border-borda bg-superficie p-6 sm:min-h-[400px] sm:p-10 lg:min-h-[440px]">
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

        <p className="rotulo mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-preto/70 px-3 py-1.5 text-amarelo">
          <span aria-hidden className="size-1.5 rounded-full bg-amarelo" /> 011 · São Paulo
        </p>
        <h1 className="titulo max-w-3xl text-[3.4rem] sm:text-7xl lg:text-8xl">{config.banner_titulo}</h1>
        {config.banner_texto && (
          <p className="mt-3 max-w-xl text-base text-branco/90 sm:text-lg">{config.banner_texto}</p>
        )}
        {config.banner_botao_texto && (
          <a
            href={link}
            {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="mt-6 inline-flex h-14 w-fit items-center gap-2 rounded-full bg-rosa px-7 text-lg font-bold text-preto shadow-[0_10px_30px_-10px_rgba(255,92,138,0.8)] transition-transform hover:bg-[#ff7a9f] active:scale-[0.97]"
          >
            {config.banner_botao_texto}
            {!externo && <ArrowDown aria-hidden className="size-5" />}
          </a>
        )}
      </div>
    </section>
  );
}
