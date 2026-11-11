import { Suspense } from "react";
import { CadastroProduto } from "@/components/admin/cadastro-produto";
import { Carregando } from "@/components/admin/ui";

export const metadata = { title: "Editar produto" };

async function Conteudo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CadastroProduto produtoId={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Carregando texto="Carregando cadastro…" />}><Conteudo params={params} /></Suspense>;
}
