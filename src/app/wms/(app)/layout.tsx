import { Suspense } from "react";
import { Carregando } from "@/components/admin/ui";
import { ShellWms } from "@/components/wms/shell";

export default function AppWmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Carregando texto="Abrindo o WMS…" />}>
      <ShellWms>{children}</ShellWms>
    </Suspense>
  );
}
