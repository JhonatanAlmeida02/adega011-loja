import { Painel } from "@/components/admin/painel";

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <Painel>{children}</Painel>;
}
