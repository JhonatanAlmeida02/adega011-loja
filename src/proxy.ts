import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Protege /admin: renova a sessão do Supabase (cookies) e manda para o login
 * quem não estiver autenticado. A autorização de verdade fica no banco (RLS)
 * e na Server Action, que conferem se o usuário é admin.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) return NextResponse.next();

  let resposta = NextResponse.next({ request });
  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        resposta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const caminho = request.nextUrl.pathname;
  const naLogin = caminho.startsWith("/admin/login");
  // Telas que precisam abrir sem sessão: login, recuperar senha e retorno do link do e-mail.
  const publica = naLogin || caminho.startsWith("/admin/recuperar") || caminho.startsWith("/admin/auth/");
  if (!user && !publica) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/admin/login";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  if (user && naLogin) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/admin";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  return resposta;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
