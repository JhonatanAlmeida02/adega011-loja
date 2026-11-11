import { Suspense } from "react";
import { CadastroProduto } from "@/components/admin/cadastro-produto";
import { Carregando } from "@/components/admin/ui";

export const metadata = { title: "Novo produto" };

export default function Page() {
  return <Suspense fallback={<Carregando texto="Carregando cadastro…" />}><CadastroProduto /></Suspense>;
}
