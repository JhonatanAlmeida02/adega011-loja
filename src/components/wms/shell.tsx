"use client";

import {
  ArrowLeftRight, BarChart3, Boxes, ClipboardCheck, ClipboardList, FileSearch, Home, LogOut, Menu, Package, PackageCheck, PackageOpen,
  PlugZap, RotateCcw, Settings, ShieldCheck, Truck, Warehouse, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Carregando } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/campos";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { cn } from "@/lib/utils";
import { ProvedorWms, useWms } from "./contexto";

const MENU = [
  { href: "/wms", rotulo: "Visão geral", icone: Home, perm: null },
  { href: "/wms/recebimento", rotulo: "Recebimento", icone: PackageOpen, perm: "receipts.check" },
  { href: "/wms/armazenagem", rotulo: "Armazenagem", icone: Warehouse, perm: "stock.putaway" },
  { href: "/wms/estoque", rotulo: "Estoque", icone: Boxes, perm: "stock.read" },
  { href: "/wms/movimentacoes", rotulo: "Movimentações", icone: ArrowLeftRight, perm: "stock.read" },
  { href: "/wms/pedidos", rotulo: "Pedidos", icone: ClipboardList, perm: "orders.read" },
  { href: "/wms/separacao", rotulo: "Separação", icone: Package, perm: "picking.execute" },
  { href: "/wms/conferencia", rotulo: "Conferência", icone: ClipboardCheck, perm: "packing.execute" },
  { href: "/wms/embalagem", rotulo: "Embalagem", icone: PackageCheck, perm: "packing.execute" },
  { href: "/wms/expedicao", rotulo: "Expedição", icone: Truck, perm: "shipments.load" },
  { href: "/wms/inventario", rotulo: "Inventário", icone: FileSearch, perm: "inventory.count" },
  { href: "/wms/devolucoes", rotulo: "Devoluções", icone: RotateCcw, perm: "returns.receive" },
  { href: "/wms/indicadores", rotulo: "Indicadores", icone: BarChart3, perm: "reports.read" },
  { href: "/wms/integracoes", rotulo: "Integrações", icone: PlugZap, perm: "integrations.read" },
  { href: "/wms/auditoria", rotulo: "Auditoria", icone: ShieldCheck, perm: "audit.read" },
  { href: "/wms/administracao", rotulo: "Administração", icone: Settings, perm: "users.manage" },
] as const;

async function sair() {
  await supabaseNavegador().auth.signOut();
  location.href = "/wms/login";
}

function Casco({ children }: { children: React.ReactNode }) {
  const { me, org, armazem, setArmazem, pode } = useWms();
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const itens = MENU.filter((m) => !m.perm || pode(m.perm) || (m.perm === "users.manage" && pode("admin.settings")));
  const nav = (
    <nav aria-label="Menu do WMS" className="flex flex-col gap-1">
      {itens.map((m) => {
        const ativo = m.href === "/wms" ? caminho === "/wms" : caminho.startsWith(m.href);
        return (
          <Link key={m.href} href={m.href} onClick={() => setAberto(false)} aria-current={ativo ? "page" : undefined}
            className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-superficie-3",
              ativo && "bg-superficie-3 text-rosa-texto")}>
            <m.icone aria-hidden className="size-5" />
            {m.rotulo}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-dvh bg-fundo text-texto">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-superficie px-4 py-2">
        <Button variant="fantasma" size="icone" className="lg:hidden" aria-label={aberto ? "Fechar menu" : "Abrir menu"} onClick={() => setAberto(!aberto)}>
          {aberto ? <X /> : <Menu />}
        </Button>
        <Link href="/wms" className="font-bold">WMS · {org.organization_name}</Link>
        <div className="ml-auto flex items-center gap-2">
          {org.warehouses.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-suave">
              <span className="sr-only sm:not-sr-only">Armazém</span>
              <Select aria-label="Armazém" value={armazem?.id ?? ""} onChange={(e) => setArmazem(e.target.value)} className="h-9 min-w-28">
                {org.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </Select>
            </label>
          )}
          <Link href="/wms/conta" className="hidden text-right text-xs leading-tight sm:block">
            <span className="block font-semibold">{me.profile?.full_name || "Operador"}</span>
            <span className={me.aal === "aal2" ? "text-sucesso" : "text-amarelo-texto"}>{me.aal === "aal2" ? "MFA verificado" : "Sem MFA nesta sessão"}</span>
          </Link>
          <Button variant="suave" size="md" onClick={sair}><LogOut /> Sair</Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px]">
        <aside className={cn("fixed inset-y-0 left-0 z-20 w-64 overflow-y-auto border-r border-borda bg-superficie p-3 pt-16 lg:sticky lg:top-[57px] lg:block lg:h-[calc(100dvh-57px)] lg:pt-3",
          aberto ? "block" : "hidden")}>
          {nav}
        </aside>
        <main id="conteudo" className="min-w-0 flex-1 p-4 pb-16">
          {armazem ? children : <p className="text-suave">Seu usuário não tem acesso a nenhum armazém. Peça ao administrador.</p>}
        </main>
      </div>
    </div>
  );
}

export function ShellWms({ children }: { children: React.ReactNode }) {
  return (
    <ProvedorWms
      carregando={<Carregando texto="Abrindo o WMS…" />}
      semAcesso={(me, erro) => (
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-borda bg-superficie p-6 text-center">
          <h1 className="text-xl font-bold">Acesso não liberado</h1>
          <p className="mt-2 text-sm text-suave">
            {erro ?? (me ? "Seu usuário não tem vínculo ativo com nenhuma empresa no WMS. Peça um convite ao administrador." : "Entre para continuar.")}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="suave" onClick={sair}>Sair</Button>
            <Button asChild><Link href="/wms/login">Entrar</Link></Button>
          </div>
        </div>
      )}>
      <Casco>{children}</Casco>
    </ProvedorWms>
  );
}
