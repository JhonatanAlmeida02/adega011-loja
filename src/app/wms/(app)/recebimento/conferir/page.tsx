"use client";

import { useSearchParams } from "next/navigation";
import Tela from "./tela";

// Rota estática com ?id= (o layout já envolve a página em <Suspense>).
export default function Page() {
  const id = useSearchParams().get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return <p className="text-suave">Registro não informado.</p>;
  return <Tela key={id} id={id} />;
}
