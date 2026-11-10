import { Suspense } from "react";
import { FormRecuperar } from "@/components/admin/form-recuperar";

export const metadata = { title: "Recuperar senha" };

export default function RecuperarPage() {
  // useSearchParams (aviso de link expirado) precisa de Suspense.
  return (
    <Suspense>
      <FormRecuperar />
    </Suspense>
  );
}
