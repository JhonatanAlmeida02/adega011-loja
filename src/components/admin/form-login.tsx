"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { CartaoAuth } from "./cartao-auth";

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
    <CartaoAuth titulo="Painel da adega" subtitulo="Acesso exclusivo do dono">
      <form onSubmit={entrar} className="space-y-4" noValidate>
        <Campo label="E-mail" htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Campo>
        <Campo label="Senha" htmlFor="login-senha">
          <Input
            id="login-senha"
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
        <Link
          href="/admin/recuperar"
          className="block py-2 text-center text-sm font-bold text-rosa underline-offset-4 hover:underline"
        >
          Esqueci minha senha
        </Link>
      </form>
    </CartaoAuth>
  );
}
