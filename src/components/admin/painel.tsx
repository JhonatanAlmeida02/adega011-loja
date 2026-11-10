"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, ExternalLink, Image as IconeImagem, LayoutGrid, LogOut, Package, Settings, Truck } from "lucide-react";
import { useSessaoAdmin } from "@/lib/admin/sessao";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Carregando } from "./ui";

const LINKS = [
  { href: "/admin", rotulo: "Pedidos", icone: ClipboardList },
  { href: "/admin/produtos", rotulo: "Produtos", icone: Package },
  { href: "/admin/categorias", rotulo: "Categorias", icone: LayoutGrid },
  { href: "/admin/banner", rotulo: "Banner", icone: IconeImagem },
  { href: "/admin/entrega", rotulo: "Entrega", icone: Truck },
  { href: "/admin/loja", rotulo: "Loja", icone: Settings },
] as const;

export function Painel({ children }: { children: React.ReactNode }) {
  const sessao = useSessaoAdmin();
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
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-borda bg-superficie p-5 md:flex">
        <Link href="/admin" className="flex items-center gap-3">
          <Image src="/logo-selo.svg" alt="" width={48} height={48} />
          <span>
            <span className="titulo block text-2xl">Adega011</span>
            <span className="rotulo text-rosa">Painel</span>
          </span>
        </Link>
        <nav aria-label="Painel" className="mt-8 flex flex-col gap-1">
          {LINKS.map(({ href, rotulo, icone: Icone }) => (
            <Link
              key={href}
              href={href}
              aria-current={ativo(href) ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-xl px-4 font-bold transition-colors",
                ativo(href) ? "bg-rosa text-preto" : "text-branco hover:bg-superficie-3",
              )}
            >
              <Icone className="size-5" aria-hidden /> {rotulo}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <p className="truncate px-1 text-sm text-suave" title={sessao.email}>
            {sessao.email}
          </p>
          <Button asChild variant="suave" size="sm" className="w-full">
            <a href="/" target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Ver loja
            </a>
          </Button>
          <Button variant="fantasma" size="sm" className="w-full" onClick={sair}>
            <LogOut /> Sair
          </Button>
        </div>
      </aside>

      {/* Topo (celular) */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-preto/90 px-4 py-3 backdrop-blur md:hidden">
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-32 md:px-8 md:pt-10 md:pb-16">{children}</main>

      {/* Navegação inferior (celular) */}
      <nav
        aria-label="Painel"
        className="pb-seguro fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-borda bg-superficie/95 px-1 pt-1 backdrop-blur md:hidden"
      >
        {LINKS.map(({ href, rotulo, icone: Icone }) => (
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
      </nav>
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">{children}</div>;
}
