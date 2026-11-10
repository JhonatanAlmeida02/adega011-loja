"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinhasRuaBanner } from "@/components/marca/grafismos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";

export function FormLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    if (!supabaseConfigurado) {
      setErro("Supabase não configurado. Veja o README.");
      return;
    }
    setEntrando(true);
    const { error } = await supabaseNavegador().auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) {
      setErro(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : error.message);
      return;
    }
    router.replace("/admin");
    router.refresh();
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <LinhasRuaBanner className="absolute inset-0 h-full w-full opacity-25" animar={false} />
      <form
        onSubmit={entrar}
        className="relative w-full max-w-sm animate-entrar rounded-[1.75rem] border border-borda bg-superficie/95 p-7 shadow-2xl backdrop-blur"
        noValidate
      >
        <Image src="/logo-selo.svg" alt="Adega011" width={80} height={80} className="mx-auto" />
        <h1 className="titulo mt-5 text-center text-4xl">Painel da adega</h1>
        <p className="mt-1 text-center text-sm text-suave">Acesso exclusivo do dono</p>
        <div className="mt-7 space-y-4">
          <Campo label="E-mail" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Campo>
          <Campo label="Senha" htmlFor="senha">
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </Campo>
          {erro && (
            <p role="alert" className="text-sm text-perigo">
              {erro}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={entrando || !email || !senha}>
            {entrando ? "Entrando…" : "Entrar"}
          </Button>
        </div>
        <Link href="/" className="mt-5 block text-center text-sm text-suave underline-offset-4 hover:text-branco hover:underline">
          ← Voltar para a loja
        </Link>
      </form>
    </main>
  );
}
