"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Landmark,
  ShoppingBag,
  Store,
  Tags,
  Warehouse,
  Boxes,
  ClipboardList,
  ClipboardCheck,
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
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useSessaoAdmin } from "@/lib/admin/sessao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Carregando } from "./ui";
import { AlternarTema } from "@/components/tema/alternar-tema";
import { LogoTema, SELO } from "@/components/tema/logo-tema";

type LinkPainel = { href: string; rotulo: string; icone: LucideIcon; principal: boolean };

/** Menu do painel por seções (barra lateral e "Mais" no celular). */
const SECOES: { titulo: string; icone: LucideIcon; links: LinkPainel[] }[] = [
  {
    titulo: "Vendas",
    icone: ShoppingBag,
    links: [
      { href: "/admin", rotulo: "Pedidos", icone: ClipboardList, principal: true },
      { href: "/admin/pdv", rotulo: "PDV", icone: ShoppingCart, principal: true },
      { href: "/admin/relatorios", rotulo: "Relatórios", icone: BarChart3, principal: false },
    ],
  },
  {
    titulo: "Catálogo",
    icone: Tags,
    links: [
      { href: "/admin/produtos", rotulo: "Produtos", icone: Package, principal: true },
      { href: "/admin/categorias", rotulo: "Categorias", icone: LayoutGrid, principal: false },
    ],
  },
  {
    titulo: "Suprimentos",
    icone: Warehouse,
    links: [
      { href: "/admin/estoque", rotulo: "Estoque", icone: Boxes, principal: true },
      { href: "/admin/ordens-entrada", rotulo: "Ordens de entrada", icone: ClipboardCheck, principal: false },
    ],
  },
  {
    titulo: "Finanças",
    icone: Wallet,
    links: [
      { href: "/admin/financeiro", rotulo: "Contas e extrato", icone: Landmark, principal: false },
      { href: "/admin/contas-a-pagar", rotulo: "Contas a pagar", icone: ArrowUpFromLine, principal: false },
      { href: "/admin/contas-a-receber", rotulo: "Contas a receber", icone: ArrowDownToLine, principal: false },
      { href: "/admin/calendario-contas", rotulo: "Calendário", icone: CalendarDays, principal: false },
    ],
  },
  {
    titulo: "Loja",
    icone: Store,
    links: [
      { href: "/admin/loja", rotulo: "Configurações", icone: Settings, principal: false },
      { href: "/admin/entrega", rotulo: "Entrega", icone: Truck, principal: false },
      { href: "/admin/banner", rotulo: "Banner", icone: IconeImagem, principal: false },
    ],
  },
];
const LINKS = SECOES.flatMap((s) => s.links);

export function Painel({ children }: { children: React.ReactNode }) {
  const sessao = useSessaoAdmin();
  const [mais, setMais] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  // Sanfona: abre a seção da tela atual; a pessoa pode abrir outra (vale até mudar de tela)
  const [escolha, setEscolha] = useState<{ pagina: string; secao: string | null } | null>(null);
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
          A loja está em modo demonstração. Configure as variáveis <code className="text-amarelo-texto">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code className="text-amarelo-texto">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (veja o README) para usar o painel.
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
          {sessao.email} não tem permissão de administrador. Rode <code className="text-amarelo-texto">npm run criar-admin</code> com
          esse e-mail ou entre com outra conta.
        </p>
        <Button className="mt-6" onClick={sair}>
          Sair
        </Button>
      </Centro>
    );
  }

  const ativo = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const secaoDaPagina = SECOES.find((secao) => secao.links.some((l) => ativo(l.href)))?.titulo ?? null;
  const secaoAberta = escolha && escolha.pagina === pathname ? escolha.secao : secaoDaPagina;
  const alternarSecao = (titulo: string) => {
    if (recolhida) {
      // Menu fechado: o ícone da seção abre o menu já com ela aberta
      setRecolhida(false);
      setEscolha({ pagina: pathname, secao: titulo });
      return;
    }
    setEscolha({ pagina: pathname, secao: secaoAberta === titulo ? null : titulo });
  };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row" style={{ "--sidebar-width": recolhida ? "72px" : "14rem" } as React.CSSProperties}>
      {/* Barra lateral (desktop) */}
      <aside id="sidebar-painel" className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-borda bg-superficie transition-[width] duration-200 motion-reduce:transition-none md:flex print:hidden",
        recolhida ? "w-[72px]" : "w-56",
      )}>
        <div className={cn("flex h-16 shrink-0 items-center border-b border-borda", recolhida ? "justify-center" : "gap-2 px-4")}>
          <Link href="/admin" aria-label="Adega011 · Painel" className={cn("flex min-w-0 flex-1 items-center justify-center gap-2", recolhida && "hidden")}>
            {!recolhida && <LogoTema {...SELO} alt="" width={36} height={36} />}
            {!recolhida && <span className="min-w-0 flex-1"><span className="titulo block text-xl">Adega011</span><span className="text-xs text-suave">Painel da loja</span></span>}
          </Link>
          <button type="button" onClick={() => setRecolhida((v) => !v)}
            aria-label={recolhida ? "Expandir menu lateral" : "Recolher menu lateral"}
            aria-expanded={!recolhida} aria-controls="links-painel"
            title={recolhida ? "Expandir menu" : "Recolher menu"}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-suave hover:bg-superficie-3 hover:text-texto"
          >
            {recolhida ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
        <nav id="links-painel" aria-label="Painel" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {SECOES.map((secao) => {
            const aberta = !recolhida && secaoAberta === secao.titulo;
            const temAtiva = secao.titulo === secaoDaPagina;
            const IconeSecao = secao.icone;
            const id = `secao-${secao.titulo.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}`;
            return (
              <div key={secao.titulo}>
                <button type="button" onClick={() => alternarSecao(secao.titulo)}
                  aria-expanded={recolhida ? undefined : aberta} aria-controls={recolhida ? undefined : id}
                  aria-label={recolhida ? `${secao.titulo} (abrir menu)` : undefined} title={recolhida ? secao.titulo : undefined}
                  className={cn(
                    "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg text-sm font-semibold transition-colors",
                    recolhida ? "justify-center" : "px-3",
                    temAtiva && (recolhida || !aberta) ? "bg-rosa/10 text-rosa-texto" : "text-texto hover:bg-superficie-3",
                  )}>
                  <IconeSecao className={cn("size-5 shrink-0", !temAtiva && "text-suave")} aria-hidden />
                  {!recolhida && <span className="flex-1 text-left">{secao.titulo}</span>}
                  {!recolhida && <ChevronDown className={cn("size-4 shrink-0 text-suave transition-transform duration-200 motion-reduce:transition-none", aberta && "rotate-180")} aria-hidden />}
                </button>
                {!recolhida && (
                  // Abre e fecha com animação de altura (grid 0fr → 1fr)
                  <div id={id} role="group" aria-label={secao.titulo} inert={!aberta}
                    className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", aberta ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                    <div className="overflow-hidden">
                      <div className="ml-5 flex flex-col gap-0.5 border-l border-borda py-1 pl-2">
                        {secao.links.map(({ href, rotulo, icone: Icone }) => (
                          <Link key={href} href={href} aria-current={ativo(href) ? "page" : undefined}
                            className={cn(
                              "flex h-9 shrink-0 items-center gap-3 rounded-lg px-2 text-sm font-medium transition-colors",
                              ativo(href) ? "bg-rosa/10 text-rosa-texto" : "text-suave hover:bg-superficie-3 hover:text-texto",
                            )}>
                            <Icone className="size-4 shrink-0" aria-hidden />
                            <span>{rotulo}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {/* Rodapé compacto: e-mail e, numa linha só, tema, ver loja e sair */}
        <div className="shrink-0 border-t border-borda p-2">
          {!recolhida && <p className="truncate px-2 pt-1 pb-1.5 text-xs text-suave" title={sessao.email}>{sessao.email}</p>}
          <div className={cn("flex gap-1", recolhida ? "flex-col items-center" : "items-center justify-between")}>
            <AlternarTema className="size-10 rounded-lg text-suave hover:bg-superficie-3 hover:text-texto" />
            <a href="/" target="_blank" rel="noopener noreferrer" aria-label="Ver loja (abre em nova aba)" title="Ver loja"
              className="grid size-10 place-items-center rounded-lg text-suave hover:bg-superficie-3 hover:text-texto">
              <ExternalLink className="size-5" />
            </a>
            <button type="button" onClick={sair} aria-label="Sair" title="Sair"
              className="grid size-10 cursor-pointer place-items-center rounded-lg text-suave hover:bg-superficie-3 hover:text-texto">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Topo (celular) */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-fundo/90 px-4 py-3 backdrop-blur md:hidden print:hidden">
        <LogoTema {...SELO} alt="" width={40} height={40} />
        <span className="titulo flex-1 text-2xl">Painel</span>
        <AlternarTema className="size-11 hover:bg-superficie-3" />
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
        pathname.startsWith("/admin/pdv") ? "max-w-none pt-3 md:pt-5 md:pb-5" : pathname.startsWith("/admin/produtos") || pathname.startsWith("/admin/estoque") || pathname.startsWith("/admin/financeiro") || pathname.startsWith("/admin/contas-a-") || pathname.startsWith("/admin/calendario") ? "max-w-none md:pt-6 md:pb-12" : "max-w-5xl md:pt-6 md:pb-12",
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
              ativo(href) ? "text-rosa-texto" : "text-suave",
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
            LINKS.some((l) => !l.principal && ativo(l.href)) ? "text-rosa-texto" : "text-suave",
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
            <nav aria-label="Mais opções do painel" className="mt-4 space-y-5">
              {SECOES.map((secao) => {
                const extras = secao.links.filter((l) => !l.principal);
                if (!extras.length) return null;
                return (
                  <div key={secao.titulo} role="group" aria-label={secao.titulo}>
                    <p className="mb-2 text-xs font-bold tracking-wider text-suave uppercase">{secao.titulo}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {extras.map(({ href, rotulo, icone: Icone }) => (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setMais(false)}
                          aria-current={ativo(href) ? "page" : undefined}
                          className={cn(
                            "flex h-14 items-center gap-3 rounded-2xl border px-4 text-sm font-bold",
                            ativo(href) ? "border-rosa bg-rosa/10 text-rosa-texto" : "border-borda bg-superficie-2",
                          )}
                        >
                          <Icone className="size-5 shrink-0" aria-hidden /> {rotulo}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
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
