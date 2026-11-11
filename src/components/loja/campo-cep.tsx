"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { buscarCep, mascararCep, soDigitosCep, type EnderecoCep } from "@/lib/cep";
import { Campo, Input } from "@/components/ui/campos";

/**
 * CEP do cliente: ao completar os 8 números, busca rua, bairro e cidade e
 * avisa o checkout para preencher os campos. O cliente só completa o número.
 */
export function CampoCep({
  valor,
  onValor,
  onEncontrado,
}: {
  valor: string;
  onValor: (cep: string) => void;
  onEncontrado: (endereco: EnderecoCep) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const ultimo = useRef("");

  const procurar = async (cep: string) => {
    if (cep === ultimo.current) return;
    ultimo.current = cep;
    setBuscando(true);
    setAviso(null);
    const r = await buscarCep(cep);
    // O cliente pode ter mudado o CEP enquanto buscava
    if (ultimo.current !== cep) return;
    setBuscando(false);
    if (!r.ok) {
      setAviso({ tipo: "erro", texto: r.erro });
      return;
    }
    const e = r.endereco;
    setAviso({
      tipo: "ok",
      texto: e.rua
        ? `${[e.rua, e.bairro].filter(Boolean).join(", ")} · ${e.cidade}/${e.uf}. Agora é só completar o número.`
        : `CEP geral de ${e.cidade}/${e.uf}: digite a rua, o número e o bairro.`,
    });
    onEncontrado(e);
  };

  return (
    <Campo label="CEP" htmlFor="cep" erro={aviso?.tipo === "erro" ? aviso.texto : undefined}>
      <div className="flex items-center gap-3">
        <div className="relative w-40 shrink-0">
          <Input
            id="cep"
            name="cep"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={valor}
            onChange={(ev) => {
              const formatado = mascararCep(ev.target.value);
              onValor(formatado);
              const digitos = soDigitosCep(formatado);
              if (digitos.length === 8) void procurar(digitos);
              else {
                ultimo.current = "";
                setAviso(null);
                setBuscando(false);
              }
            }}
            aria-invalid={aviso?.tipo === "erro"}
            aria-describedby={aviso ? (aviso.tipo === "erro" ? "cep-erro" : "cep-ok") : undefined}
            maxLength={9}
            className="pr-9 font-mono"
          />
          {buscando && (
            <Loader2 aria-label="Buscando CEP" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-suave" />
          )}
        </div>
        <a
          href="https://buscacepinter.correios.com.br/app/endereco/index.php"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-suave underline underline-offset-4 hover:text-rosa-texto"
        >
          Não sei meu CEP
        </a>
      </div>
      {aviso?.tipo === "ok" && (
        <p id="cep-ok" role="status" className="mt-1.5 text-sm text-sucesso">
          {aviso.texto}
        </p>
      )}
    </Campo>
  );
}
