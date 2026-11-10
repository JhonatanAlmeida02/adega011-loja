import Image from "next/image";
import { Button } from "@/components/ui/button";
import { DivisorRua, LinhasRuaBanner, Padrao011 } from "@/components/marca/grafismos";

// Página provisória para conferir o tema; a vitrine entra na próxima etapa.
export default function Home() {
  return (
    <main className="relative mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <div className="absolute inset-0 -z-10">
        <Padrao011 />
      </div>
      <Image src="/logo-selo.svg" alt="Adega011" width={96} height={96} priority />
      <h1 className="titulo mt-6 text-6xl">São Paulo no copo</h1>
      <p className="mt-3 max-w-md text-suave">Tema base da Adega011.</p>
      <p className="preco mt-4 text-2xl">R$ 49,90</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button>Adicionar</Button>
        <Button variant="contorno">Ver cardápio</Button>
        <Button variant="destaque">Destaque</Button>
      </div>
      <DivisorRua className="my-8" />
      <div className="relative h-72 overflow-hidden rounded-card bg-superficie">
        <LinhasRuaBanner className="absolute inset-0 h-full w-full" />
      </div>
    </main>
  );
}
