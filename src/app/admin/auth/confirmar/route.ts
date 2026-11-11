import { NextResponse, type NextRequest } from "next/server";
import { supabaseServidor } from "@/lib/supabase/servidor";

/**
 * Redireciona para uma página do próprio site com endereço relativo.
 * Não use request.url/nextUrl.origin aqui: atrás do proxy do Render (e de outras
 * hospedagens) ele aponta para o servidor interno, ex.: https://localhost:10000.
 */
function irPara(caminho: string) {
  return new NextResponse(null, { status: 303, headers: { Location: caminho } });
}

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
    if (!error) return irPara(destino);
  }
  return irPara("/admin/recuperar?erro=link");
}
