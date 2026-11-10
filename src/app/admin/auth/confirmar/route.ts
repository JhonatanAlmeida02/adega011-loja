import { NextResponse, type NextRequest } from "next/server";
import { supabaseServidor } from "@/lib/supabase/servidor";

/**
 * Destino do link enviado por e-mail (recuperação de senha).
 * Troca o código de uso único por uma sessão e segue para a próxima tela.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const proximo = url.searchParams.get("proximo") ?? "/admin";
  // Só aceita destinos internos do painel (evita redirecionamento aberto).
  const destino = proximo.startsWith("/admin") && !proximo.startsWith("//") ? proximo : "/admin";

  if (code) {
    const sb = await supabaseServidor();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destino, url.origin));
  }
  return NextResponse.redirect(new URL("/admin/recuperar?erro=link", url.origin));
}
