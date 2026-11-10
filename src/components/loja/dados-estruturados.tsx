import { resumoHorarios } from "@/lib/horario";
import type { Configuracoes, Horarios } from "@/lib/tipos";

const DIAS_SCHEMA = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function horariosSchema(h: Horarios) {
  return Object.entries(h).flatMap(([dia, faixas]) =>
    faixas.map((f) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DIAS_SCHEMA[Number(dia)]}`,
      opens: f.abre,
      closes: f.fecha,
    })),
  );
}

/** Lê "Rua X, 72 · Bairro, Cidade - UF" e separa cidade e estado para o Google. */
function enderecoSchema(endereco: string) {
  const m = endereco.match(/^(.*),\s*([^,·]+?)\s*-\s*([A-Z]{2})\s*$/);
  return {
    "@type": "PostalAddress",
    streetAddress: m ? m[1].trim() : endereco,
    ...(m ? { addressLocality: m[2].trim(), addressRegion: m[3] } : {}),
    addressCountry: "BR",
  };
}

/** JSON-LD (schema.org LiquorStore) para o Google entender a loja. */
export function DadosEstruturados({ config }: { config: Configuracoes }) {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const dados = {
    "@context": "https://schema.org",
    "@type": "LiquorStore",
    name: config.nome,
    slogan: config.slogan,
    url: site,
    image: `${site}/icons/icon-512.png`,
    logo: `${site}/logo-selo.svg`,
    telephone: config.whatsapp ? `+${config.whatsapp}` : undefined,
    address: config.endereco ? enderecoSchema(config.endereco) : undefined,
    openingHoursSpecification: horariosSchema(config.horarios),
    description: `Horário: ${resumoHorarios(config.horarios).map((h) => `${h.dias} ${h.horas}`).join("; ")}`,
    sameAs: config.instagram ? [`https://instagram.com/${config.instagram.replace(/^@/, "")}`] : undefined,
    currenciesAccepted: "BRL",
  };
  return (
    <script
      type="application/ld+json"
      // Escapa "<" para não fechar a tag script por acidente.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(dados).replace(/</g, "\\u003c") }}
    />
  );
}
