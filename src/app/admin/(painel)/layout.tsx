import { Suspense } from "react";
import { Painel } from "@/components/admin/painel";
import { Carregando } from "@/components/admin/ui";

/*
 * O Painel lê o endereço da página (usePathname). Em rotas com parte variável,
 * como /admin/produtos/[id], isso só existe na hora do acesso, então o Next
 * exige um <Suspense> em volta para conseguir gerar o resto da página no build.
 */
export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Carregando texto="Abrindo o painel…" />}>
      <Painel>{children}</Painel>
    </Suspense>
  );
}
