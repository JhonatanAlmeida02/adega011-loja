import { Suspense } from "react";
import { Carregando } from "@/components/admin/ui";
import { LoginWms } from "@/components/wms/login";

export const metadata = { title: "Entrar" };

export default function Pagina() {
  return (
    <Suspense fallback={<Carregando />}>
      <LoginWms />
    </Suspense>
  );
}
