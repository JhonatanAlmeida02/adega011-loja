"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  ExternalLink,
  Image as IconeImagem,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useSessaoAdmin } from "@/lib/admin/sessao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Carregando } from "./ui";

const LINKS = [
  { href: "/admin", rotulo: "Pedidos", icone: ClipboardList, principal: true },
  { href: "/admin/pdv", rotulo: "PDV", icone: ShoppingCart, principal: true },
  { href: "/admin/produtos", rotulo: "Produtos", icone: Package, principal: true },
  { href: "/admin/estoque", rotulo: "Estoque", icone: Boxes, principal: true },
  { href: "/admin/relatorios", rotulo: "Relatórios", icone: BarChart3, principal: false },
  { href: "/admin/categorias", rotulo: "Categorias", icone: LayoutGrid, principal: false },
  { href: "/admin/banner", rotulo: "Banner", icone: IconeImagem, principal: false },
  { href: "/admin/entrega", rotulo: "Entrega", icone: Truck, principal: false },
  { href: "/admin/loja", rotulo: "Loja", icone: Settings, principal: false },
] as const;

export function Painel({ children }: { children: React.ReactNode }) {
  const sessao = useSessaoAdmin();
  const [mais, setMais] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (sessao.estado === "anonimo") router.replace("/admin/login");
  }, [sessao.estado, router]);

  const sair = async () => {
    await supabaseNavegador().auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  };

  if (sessao.estado === "sem-supabase") {
    return (
      <Centro>
        <h1 className="titulo text-4xl">Painel indisponível</h1>
        <p className="mt-3 text-suave">
          A loja está em modo demonstração. Configure as variáveis <code className="text-amarelo">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code className="text-amarelo">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (veja o README) para usar o painel.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Voltar para a loja</Link>
        </Button>
      </Centro>
    );
  }
  if (sessao.estado === "carregando") return <Carregando texto="Verificando acesso…" />;
  if (sessao.estado === "anonimo") return <Carregando texto="Redirecionando…" />;
  if (sessao.estado === "negado") {
    return (
      <Centro>
        <h1 className="titulo text-4xl">Acesso negado</h1>
        <p className="mt-3 text-suave">
          {sessao.email} não tem permissão de administrador. Rode <code className="text-amarelo">npm run criar-admin</code> com
          esse e-mail ou entre com outra conta.
        </p>
        <Button className="mt-6" onClick={sair}>
          Sair
        </Button>
      </Centro>
    );
  }

  const ativo = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row" style={{ "--sidebar-width": recolhida ? "72px" : "14rem" } as React.CSSProperties}>
      {/* Barra lateral (desktop) */}
      <aside id="sidebar-painel" className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-borda bg-superficie transition-[width] duration-200 motion-reduce:transition-none md:flex print:hidden",
        recolhida ? "w-[72px]" : "w-56",
      )}>
        <div className={cn("flex h-20 shrink-0 items-center border-b border-borda", recolhida ? "justify-center" : "gap-2 px-4")}>
          <Link href="/admin" aria-label="Adega011 · Painel" className={cn("flex min-w-0 flex-1 items-center justify-center gap-2", recolhida && "hidden")}>
            {!recolhida && <Image src="/logo-selo.svg" alt="" width={36} height={36} />}
            {!recolhida && <span className="min-w-0 flex-1"><span className="titulo block text-xl">Adega011</span><span className="text-xs text-suave">Painel da loja</span></span>}
          </Link>
          <button type="button" onClick={() => setRecolhida((v) => !v)}
            aria-label={recolhida ? "Expandir menu lateral" : "Recolher menu lateral"}
            aria-expanded={!recolhida} aria-controls="links-painel"
            title={recolhida ? "Expandir menu" : "Recolher menu"}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-suave hover:bg-superficie-3 hover:text-branco"
          >
            {recolhida ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
        <nav id="links-painel" aria-label="Painel" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
          {LINKS.map(({ href, rotulo, icone: Icone }) => (
            <Link key={href} href={href} aria-label={rotulo} title={recolhida ? rotulo : undefined}
              aria-current={ativo(href) ? "page" : undefined}
              className={cn(
                "flex h-11 shrink-0 items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                recolhida ? "justify-center" : "px-3",
                ativo(href) ? "bg-rosa/10 text-rosa" : "text-suave hover:bg-superficie-3 hover:text-branco",
              )}
            >
              <Icone className="size-5 shrink-0" aria-hidden />
              {!recolhida && <span>{rotulo}</span>}
            </Link>
          ))}
        </nav>
        <div className="shrink-0 space-y-1 border-t border-borda p-3">
          {!recolhida && <p className="mb-3 truncate px-2 text-xs text-suave" title={sessao.email}>{sessao.email}</p>}
          <a href="/" target="_blank" rel="noopener noreferrer" aria-label="Ver loja (abre em nova aba)" title="Ver loja"
            className={cn("flex h-10 items-center gap-3 rounded-lg text-sm text-suave hover:bg-superficie-3 hover:text-branco", recolhida ? "justify-center" : "px-3")}>
            <ExternalLink className="size-5 shrink-0" />{!recolhida && "Ver loja"}
          </a>
          <button type="button" onClick={sair} aria-label="Sair" title="Sair"
            className={cn("flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg text-sm text-suave hover:bg-superficie-3 hover:text-branco", recolhida ? "justify-center" : "px-3")}>
            <LogOut className="size-5 shrink-0" />{!recolhida && "Sair"}
          </button>
        </div>
      </aside>

      {/* Topo (celular) */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-preto/90 px-4 py-3 backdrop-blur md:hidden print:hidden">
        <Image src="/logo-selo.svg" alt="" width={40} height={40} />
        <span className="titulo flex-1 text-2xl">Painel</span>
        <Button asChild variant="fantasma" size="icone" aria-label="Ver loja (abre em nova aba)">
          <a href="/" target="_blank" rel="noopener noreferrer">
            <ExternalLink />
          </a>
        </Button>
        <Button variant="fantasma" size="icone" onClick={sair} aria-label="Sair">
          <LogOut />
        </Button>
      </header>

      <main className={cn(
        "mx-auto min-w-0 w-full flex-1 px-4 pt-6 pb-32 md:px-6",
        pathname.startsWith("/admin/pdv") ? "max-w-none md:pt-5 md:pb-5" : "max-w-5xl md:pt-10 md:pb-16",
      )}>{children}</main>

      {/* Navegação inferior (celular) */}
      <nav
        aria-label="Painel"
        className="pb-seguro fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-borda bg-superficie/95 px-1 pt-1 backdrop-blur md:hidden print:hidden"
      >
        {LINKS.filter((l) => l.principal).map(({ href, rotulo, icone: Icone }) => (
          <Link
            key={href}
            href={href}
            aria-current={ativo(href) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[0.68rem] font-bold",
              ativo(href) ? "text-rosa" : "text-suave",
            )}
          >
            <Icone className="size-5" aria-hidden />
            {rotulo}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMais(true)}
          aria-expanded={mais}
          className={cn(
            "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-[0.68rem] font-bold",
            LINKS.some((l) => !l.principal && ativo(l.href)) ? "text-rosa" : "text-suave",
          )}
        >
          <Menu className="size-5" aria-hidden />
          Mais
        </button>
      </nav>
      <Sheet open={mais} onOpenChange={setMais}>
        <SheetContent rotuloFechar="Fechar menu">
          <div className="px-5 pt-4 pb-8 pr-16">
            <SheetTitle className="titulo text-3xl">Menu</SheetTitle>
            <SheetDescription className="sr-only">Outras telas do painel</SheetDescription>
            <nav aria-label="Mais opções do painel" className="mt-4 grid grid-cols-2 gap-2">
              {LINKS.filter((l) => !l.principal).map(({ href, rotulo, icone: Icone }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMais(false)}
                  aria-current={ativo(href) ? "page" : undefined}
                  className={cn(
                    "flex h-14 items-center gap-3 rounded-2xl border px-4 font-bold",
                    ativo(href) ? "border-rosa bg-rosa/10 text-rosa" : "border-borda bg-superficie-2",
                  )}
                >
                  <Icone className="size-5" aria-hidden /> {rotulo}
                </Link>
              ))}
            </nav>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">{children}</div>;
}
