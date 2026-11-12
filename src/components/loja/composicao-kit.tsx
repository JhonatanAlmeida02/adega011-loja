import type { ItemComposicao } from "@/lib/tipos";
import { cn } from "@/lib/utils";
import { FotoProduto } from "./foto-produto";

const rotulo = (i: ItemComposicao) => (i.quantidade && i.quantidade > 1 ? `${i.quantidade}x ${i.nome}` : i.nome);

/** "Vem no kit": foto e nome de cada item (tela do produto). */
export function ComposicaoKit({ itens, idBase }: { itens: ItemComposicao[]; idBase: string }) {
  if (!itens.length) return null;
  return (
    <section aria-labelledby={`${idBase}-kit`} className="pt-1">
      <h3 id={`${idBase}-kit`} className="text-sm font-semibold">
        Vem no kit
      </h3>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {itens.map((item, i) => (
          <li key={`${item.nome}-${i}`} className="rounded-lg border border-borda bg-superficie-2 p-2">
            <FotoProduto src={item.foto_url} alt="" sizes="120px" className="aspect-square w-full rounded-md" />
            <span className="mt-1.5 line-clamp-2 block text-center text-xs leading-tight">{rotulo(item)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Miniaturas pequenas dos itens do kit (card da vitrine). */
export function MiniaturasKit({ itens, className }: { itens: ItemComposicao[]; className?: string }) {
  if (!itens.length) return null;
  const visiveis = itens.slice(0, 4);
  const resto = itens.length - visiveis.length;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-suave">Vem:</span>
      <ul className="flex -space-x-2" aria-label={`Vem no kit: ${itens.map(rotulo).join(", ")}`}>
        {visiveis.map((item, i) => (
          <li key={`${item.nome}-${i}`} title={rotulo(item)}>
            <FotoProduto src={item.foto_url} alt="" sizes="28px" className="size-7 rounded-full border-2 border-superficie" />
          </li>
        ))}
        {resto > 0 && (
          <li aria-hidden className="grid size-7 place-items-center rounded-full border-2 border-superficie bg-superficie-3 text-[10px] font-bold">
            +{resto}
          </li>
        )}
      </ul>
    </div>
  );
}
