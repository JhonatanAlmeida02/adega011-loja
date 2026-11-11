import { LogoTema, SELO } from "@/components/tema/logo-tema";
import Link from "next/link";
import { LinhasRuaBanner } from "@/components/marca/grafismos";

/** Moldura das telas de acesso (login, recuperar e nova senha). */
export function CartaoAuth({
  titulo,
  subtitulo,
  children,
  rodape = { href: "/", texto: "← Voltar para a loja" },
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
  rodape?: { href: string; texto: string };
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <LinhasRuaBanner className="absolute inset-0 h-full w-full opacity-25" animar={false} />
      <div className="relative w-full max-w-sm animate-entrar rounded-[1.75rem] border border-borda bg-superficie/95 p-7 shadow-2xl backdrop-blur">
        <LogoTema {...SELO} alt="Adega011" width={80} height={80} className="mx-auto" />
        <h1 className="titulo mt-5 text-center text-4xl">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-center text-sm text-suave">{subtitulo}</p>}
        <div className="mt-7">{children}</div>
        <Link
          href={rodape.href}
          className="mt-5 block text-center text-sm text-suave underline-offset-4 hover:text-texto hover:underline"
        >
          {rodape.texto}
        </Link>
      </div>
    </main>
  );
}
