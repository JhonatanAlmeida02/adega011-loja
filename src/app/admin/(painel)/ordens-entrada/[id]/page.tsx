import { Suspense } from "react";
import { ConferenciaEntrada } from "@/components/admin/ordens-entrada";
import { Carregando } from "@/components/admin/ui";

export const metadata = { title: "Conferir entrada" };
async function Conteudo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConferenciaEntrada id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Carregando />}><Conteudo params={params} /></Suspense>;
}
