import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Linhas de rua: três linhas paralelas ortogonais com cantos arredondados.
 * Usa uma máscara SVG (traço largo branco, traço médio preto, traço fino branco)
 * para gerar as paralelas com cantos concêntricos a partir de um único caminho,
 * deixando os vãos transparentes.
 */
function LinhasParalelas({
  caminhos,
  espessura,
  vao,
  cor = "var(--color-rosa)",
  animar = false,
}: {
  caminhos: string[];
  espessura: number;
  vao: number;
  cor?: string;
  animar?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const total = espessura * 3 + vao * 2;
  const meio = espessura + vao * 2;
  const estiloAnim = animar
    ? {
        strokeDasharray: 3000,
        ["--comprimento" as string]: 3000,
        animation: "desenhar 1.6s cubic-bezier(0.6,0,0.2,1) both",
      }
    : undefined;
  return (
    <>
      <defs>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">
          {caminhos.map((d, i) => (
            <g key={i} fill="none" strokeLinecap="butt" style={estiloAnim}>
              <path d={d} stroke="#fff" strokeWidth={total} style={estiloAnim} />
              <path d={d} stroke="#000" strokeWidth={meio} style={estiloAnim} />
              <path d={d} stroke="#fff" strokeWidth={espessura} style={estiloAnim} />
            </g>
          ))}
        </mask>
      </defs>
      <rect x="-2000" y="-2000" width="6000" height="6000" fill={cor} mask={`url(#m${id})`} />
    </>
  );
}

/** Grafismo grande para o banner (quando não houver imagem). */
export function LinhasRuaBanner({ className, animar = true }: { className?: string; animar?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none", className)}
    >
      <LinhasParalelas
        animar={animar}
        espessura={6}
        vao={11}
        caminhos={[
          "M -60 150 H 560 A 90 90 0 0 1 650 240 V 380 A 90 90 0 0 0 740 470 H 1260",
          "M 1260 70 H 1010 A 70 70 0 0 0 940 140 V 230 A 70 70 0 0 1 870 300 H 820",
          "M 120 660 V 470 A 80 80 0 0 1 200 390 H 330",
        ]}
      />
      <circle cx="940" cy="470" r="46" fill="none" stroke="var(--color-amarelo)" strokeWidth="6" />
      <circle cx="940" cy="470" r="22" fill="none" stroke="var(--color-amarelo)" strokeWidth="6" />
    </svg>
  );
}

/** Divisor horizontal com degrau, usado entre seções. */
export function DivisorRua({ className, cor }: { className?: string; cor?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 64"
      preserveAspectRatio="none"
      className={cn("pointer-events-none h-10 w-full", className)}
    >
      <LinhasParalelas
        cor={cor}
        espessura={3}
        vao={5}
        caminhos={["M -20 16 H 560 A 16 16 0 0 1 576 32 A 16 16 0 0 0 592 48 H 1220"]}
      />
    </svg>
  );
}

/** Padrão de fundo com dígitos "011", anéis e barras. */
export function Padrao011({ className, opacidade = 0.08 }: { className?: string; opacidade?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden className={cn("pointer-events-none h-full w-full", className)}>
      <defs>
        <pattern id={`p${id}`} width="180" height="180" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
          <text
            x="10"
            y="62"
            fontSize="54"
            fill="none"
            stroke="var(--color-rosa)"
            strokeWidth="1.5"
            style={{ fontFamily: "var(--font-anton), Impact, sans-serif" }}
          >
            011
          </text>
          <circle cx="140" cy="40" r="18" fill="none" stroke="var(--color-rosa)" strokeWidth="2" />
          <circle cx="140" cy="40" r="8" fill="none" stroke="var(--color-rosa)" strokeWidth="2" />
          <rect x="20" y="110" width="70" height="10" rx="5" fill="var(--color-rosa)" />
          <rect x="20" y="130" width="44" height="10" rx="5" fill="var(--color-amarelo)" />
          <circle cx="135" cy="135" r="26" fill="none" stroke="var(--color-texto)" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#p${id})`} opacity={opacidade} />
    </svg>
  );
}
