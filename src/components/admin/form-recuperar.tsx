"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { CartaoAuth } from "./cartao-auth";

const ERROS: Record<string, string> = {
  link: "Esse link expirou ou já foi usado. Peça um novo abaixo (abra o e-mail no mesmo navegador em que pediu).",
};

export function FormRecuperar() {
  const params = useSearchParams();
  const erroLink = ERROS[params.get("erro") ?? ""];
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"livre" | "enviando" | "enviado">("livre");
  const [erro, setErro] = useState("");

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    if (!supabaseConfigurado) return setErro("Supabase não configurado. Veja o README.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErro("Informe um e-mail válido.");
    setEstado("enviando");
    const { error } = await supabaseNavegador().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/admin/auth/confirmar?proximo=/admin/nova-senha`,
    });
    // Limite de envios é o único erro mostrado; o resto vira a mesma mensagem
    // genérica, para não revelar quais e-mails têm conta.
    if (error && /rate|seconds|limit/i.test(error.message)) {
      setEstado("livre");
      return setErro("Muitas tentativas. Aguarde um minuto e tente de novo.");
    }
    setEstado("enviado");
  };

  if (estado === "enviado") {
    return (
      <CartaoAuth titulo="Confira seu e-mail" rodape={{ href: "/admin/login", texto: "← Voltar para o login" }}>
        <div className="text-center" role="status">
          <MailCheck className="mx-auto size-12 text-sucesso" aria-hidden />
          <p className="mt-4 text-suave">
            Se <strong className="text-branco">{email.trim()}</strong> for o e-mail do painel, você vai receber um link
            para criar uma nova senha. Abra o link neste mesmo navegador.
          </p>
        </div>
      </CartaoAuth>
    );
  }

  return (
    <CartaoAuth
      titulo="Recuperar senha"
      subtitulo="Enviamos um link para você criar uma nova senha"
      rodape={{ href: "/admin/login", texto: "← Voltar para o login" }}
    >
      <form onSubmit={enviar} className="space-y-4" noValidate>
        {erroLink && (
          <p role="alert" className="rounded-xl border border-rosa/50 bg-rosa/10 p-3 text-sm">
            {erroLink}
          </p>
        )}
        <Campo label="E-mail" htmlFor="recuperar-email" erro={erro}>
          <Input
            id="recuperar-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!erro}
            required
          />
        </Campo>
        <Button type="submit" size="lg" className="w-full" disabled={estado === "enviando" || !email}>
          {estado === "enviando" ? "Enviando…" : "Enviar link"}
        </Button>
      </form>
    </CartaoAuth>
  );
}
