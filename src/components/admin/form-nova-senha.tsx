"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/campos";
import { CartaoAuth } from "./cartao-auth";

export const SENHA_MINIMA = 8;

export function FormNovaSenha() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erros, setErros] = useState<{ senha?: string; confirmacao?: string; geral?: string }>({});
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const novos = {
      senha: senha.length < SENHA_MINIMA ? `Use pelo menos ${SENHA_MINIMA} caracteres.` : undefined,
      confirmacao: confirmacao !== senha ? "As senhas não são iguais." : undefined,
    };
    setErros(novos);
    if (novos.senha || novos.confirmacao) return;

    setSalvando(true);
    const { error } = await supabaseNavegador().auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      const msg = /session|JWT|not authenticated/i.test(error.message)
        ? "Sua sessão expirou. Peça um novo link de recuperação."
        : /different|same/i.test(error.message)
          ? "A nova senha precisa ser diferente da anterior."
          : /weak|short|characters/i.test(error.message)
            ? "Senha fraca. Use letras e números, com pelo menos 8 caracteres."
            : `Não foi possível salvar: ${error.message}`;
      return setErros({ geral: msg });
    }
    toast.success("Senha alterada!");
    router.replace("/admin");
    router.refresh();
  };

  return (
    <CartaoAuth titulo="Nova senha" subtitulo="Escolha a nova senha do painel" rodape={{ href: "/admin", texto: "Ir para o painel" }}>
      <form onSubmit={salvar} className="space-y-4" noValidate>
        <Campo label="Nova senha" htmlFor="nova-senha" erro={erros.senha} ajuda={`Mínimo de ${SENHA_MINIMA} caracteres.`}>
          <Input
            id="nova-senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            aria-invalid={!!erros.senha}
            required
          />
        </Campo>
        <Campo label="Repita a nova senha" htmlFor="nova-senha-confirmacao" erro={erros.confirmacao}>
          <Input
            id="nova-senha-confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            aria-invalid={!!erros.confirmacao}
            required
          />
        </Campo>
        {erros.geral && (
          <p role="alert" className="text-sm text-perigo">
            {erros.geral}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={salvando || !senha || !confirmacao}>
          {salvando ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </CartaoAuth>
  );
}
