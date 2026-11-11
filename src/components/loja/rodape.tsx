import { LogoTema, LOGO_HORIZONTAL } from "@/components/tema/logo-tema";
import { MapPin } from "lucide-react";
import { IconeInstagram as Instagram, IconeWhatsApp as MessageCircle } from "@/components/marca/icones";
import { resumoHorarios } from "@/lib/horario";
import { NOMES_PAGAMENTO, type Configuracoes } from "@/lib/tipos";
import { DivisorRua } from "@/components/marca/grafismos";

export function Rodape({ config }: { config: Configuracoes }) {
  const horarios = resumoHorarios(config.horarios);
  const insta = config.instagram.replace(/^@/, "");
  return (
    <footer className="mt-auto border-t border-borda bg-superficie">
      <DivisorRua className="h-8" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 pb-40 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <LogoTema {...LOGO_HORIZONTAL} alt={config.nome} width={208} height={60} className="h-14 w-auto" />
          <p className="mt-4 text-suave">Vinhos, destilados, cervejas e combos. {config.slogan}.</p>
        </div>
        <div>
          <h2 className="rotulo mb-3 text-rosa-texto">Horário</h2>
          <dl className="space-y-1.5 text-sm">
            {horarios.map((h) => (
              <div key={h.dias} className="flex justify-between gap-4 border-b border-borda/60 pb-1.5">
                <dt className="text-suave">{h.dias}</dt>
                <dd className="font-mono">{h.horas}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="rotulo mb-3 text-rosa-texto">Pagamento</h2>
          <ul className="space-y-1.5 text-sm">
            {config.pagamentos.map((p) => (
              <li key={p}>{NOMES_PAGAMENTO[p]}</li>
            ))}
          </ul>
          {config.aceita_retirada && <p className="mt-3 text-sm text-suave">Retirada na loja disponível.</p>}
        </div>
        <div>
          <h2 className="rotulo mb-3 text-rosa-texto">Contato</h2>
          <ul className="space-y-3 text-sm">
            {config.endereco && (
              <li>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.endereco)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex gap-2 hover:text-rosa-texto"
                >
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /> {config.endereco}
                </a>
              </li>
            )}
            {config.whatsapp && (
              <li>
                <a
                  href={`https://wa.me/${config.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex gap-2 hover:text-rosa-texto"
                >
                  <MessageCircle aria-hidden className="size-4 shrink-0" /> WhatsApp
                </a>
              </li>
            )}
            {insta && (
              <li>
                <a
                  href={`https://instagram.com/${insta}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex gap-2 hover:text-rosa-texto"
                >
                  <Instagram aria-hidden className="size-4 shrink-0" /> @{insta}
                </a>
              </li>
            )}
          </ul>
        </div>
        <p className="rotulo border-t border-borda pt-6 text-suave sm:col-span-2 lg:col-span-4">
          Venda proibida para menores de 18 anos · Se beber, não dirija · Beba com moderação
        </p>
      </div>
    </footer>
  );
}
