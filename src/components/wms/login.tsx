"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/campos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";

/**
 * Login do WMS: e-mail/senha (Supabase Auth) e, se o usuário tiver autenticador,
 * o código de 6 dígitos (MFA) para elevar a sessão a aal2. Mensagens sem
 * enumeração de usuários.
 */
export function LoginWms() {
  const volta = useSearchParams().get("volta");
  const destino = volta && volta.startsWith("/wms") && !volta.startsWith("//") ? volta : "/wms";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [etapa, setEtapa] = useState<"senha" | "mfa">("senha");
  const [fator, setFator] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!supabaseConfigurado) {
    return <p className="mx-auto mt-24 max-w-md p-4 text-center text-suave">WMS indisponível: Supabase não configurado neste ambiente.</p>;
  }
  const sb = supabaseNavegador();

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) {
        setErro("E-mail ou senha inválidos.");
        return;
      }
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        const { data: fatores } = await sb.auth.mfa.listFactors();
        const totp = fatores?.totp?.find((f) => f.status === "verified");
        if (totp) {
          setFator(totp.id);
          setEtapa("mfa");
          return;
        }
      }
      location.href = destino;
    } finally {
      setEnviando(false);
    }
  };

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fator) return;
    setErro(null);
    setEnviando(true);
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fator, code: codigo.trim() });
    setEnviando(false);
    if (error) {
      setErro("Código inválido ou expirado.");
      return;
    }
    location.href = destino;
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-fundo p-4 text-texto">
      <div className="w-full max-w-sm rounded-xl border border-borda bg-superficie p-6">
        <h1 className="text-2xl font-bold">WMS</h1>
        <p className="mb-4 text-sm text-suave">Acesso individual. Em coletor compartilhado, saia ao terminar o turno.</p>
        {etapa === "senha" ? (
          <form onSubmit={entrar} className="space-y-3">
            <div><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" /></div>
            <div><Label htmlFor="senha">Senha</Label><Input id="senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="h-12" /></div>
            {erro && <p role="alert" className="text-sm text-perigo">{erro}</p>}
            <Button type="submit" size="lg" className="h-12 w-full" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</Button>
          </form>
        ) : (
          <form onSubmit={verificar} className="space-y-3">
            <div><Label htmlFor="codigo">Código do autenticador</Label>
              <Input id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value)} className="h-12 font-mono text-lg" /></div>
            {erro && <p role="alert" className="text-sm text-perigo">{erro}</p>}
            <Button type="submit" size="lg" className="h-12 w-full" disabled={enviando}>Verificar</Button>
          </form>
        )}
      </div>
    </main>
  );
}
