"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/campos";
import { useWms } from "@/components/wms/contexto";
import { lerPreferencias, Painel, salvarPreferencias, Titulo } from "@/components/wms/ui";
import { supabaseNavegador } from "@/lib/supabase/navegador";
import type { Terminador } from "@/lib/wms/scanner";

export default function Conta() {
  const { me, org } = useWms();
  const sb = supabaseNavegador();
  const [fatores, setFatores] = useState<{ id: string; status: string; friendly_name?: string }[]>([]);
  const [qr, setQr] = useState<{ id: string; svg: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pref, setPref] = useState(lerPreferencias());

  const [rodada, setRodada] = useState(0);
  const carregar = async () => setRodada((n) => n + 1);
  useEffect(() => {
    let vivo = true;
    supabaseNavegador().auth.mfa.listFactors().then(({ data }) => {
      if (vivo) setFatores((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name })));
    });
    return () => {
      vivo = false;
    };
  }, [rodada]);

  const cadastrar = async () => {
    setMsg(null);
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `WMS ${new Date().toLocaleDateString("pt-BR")}` });
    if (error || !data) return setMsg("Não foi possível iniciar o cadastro do autenticador.");
    setQr({ id: data.id, svg: data.totp.qr_code, segredo: data.totp.secret });
  };
  const confirmar = async () => {
    if (!qr) return;
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: qr.id, code: codigo.trim() });
    if (error) return setMsg("Código inválido.");
    setQr(null);
    setCodigo("");
    setMsg("Autenticador ativado. Sua sessão agora é verificada (MFA).");
    await carregar();
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Titulo titulo="Minha conta" descricao={`${me.profile?.full_name || "Operador"} · perfis: ${org.roles.join(", ")}`} />
      <Painel titulo="Verificação em duas etapas (MFA)">
        <p className="mb-3 text-sm text-suave">
          {org.require_mfa ? "Obrigatória para administração e aprovação de ajustes nesta empresa." : "Opcional nesta empresa."} Sessão atual:{" "}
          <strong>{me.aal === "aal2" ? "verificada" : "sem MFA"}</strong>.
        </p>
        <ul className="mb-3 text-sm">{fatores.map((f) => <li key={f.id}>• {f.friendly_name ?? "Autenticador"} — {f.status === "verified" ? "ativo" : "pendente"}</li>)}</ul>
        {!qr && <Button onClick={cadastrar}>Cadastrar autenticador</Button>}
        {qr && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.svg} alt="QR code para o aplicativo autenticador" className="size-48 rounded bg-white p-2" />
            <p className="break-all font-mono text-xs text-suave">Chave manual: {qr.segredo}</p>
            <div><Label htmlFor="cod">Código de 6 dígitos</Label><Input id="cod" inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></div>
            <Button onClick={confirmar}>Confirmar</Button>
          </div>
        )}
        {msg && <p role="status" className="mt-3 text-sm">{msg}</p>}
      </Painel>
      <Painel titulo="Leitor de código de barras deste aparelho">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="term">Terminador da leitura</Label>
            <Select id="term" value={pref.terminador} onChange={(e) => { const p = { ...pref, terminador: e.target.value as Terminador }; setPref(p); salvarPreferencias(p); }}>
              <option value="enter">Enter</option><option value="tab">Tab</option><option value="nenhum">Nenhum (botão OK)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" checked={pref.som} onChange={(e) => { const p = { ...pref, som: e.target.checked }; setPref(p); salvarPreferencias(p); }} className="size-5" />
            Aviso sonoro nas leituras
          </label>
        </div>
      </Painel>
    </div>
  );
}
