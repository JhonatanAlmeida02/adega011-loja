import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatadorBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata um valor em centavos como "R$ 00,00". */
export function formatarPreco(centavos: number): string {
  // Intl usa espaço não separável (U+00A0); trocamos por espaço comum para
  // ficar idêntico no WhatsApp e nos testes.
  return formatadorBRL.format(centavos / 100).replace(/ /g, " ");
}

/** Converte "12,50" / "12.50" / "R$ 12,50" em centavos (1250). */
export function paraCentavos(valor: string): number | null {
  const limpo = valor.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  // Se houver vírgula, ela é o separador decimal (padrão BR).
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

/** Centavos -> "12,50" para preencher campos de formulário. */
export function centavosParaCampo(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Máscara simples de telefone BR: (11) 91234-5678 */
export function mascararTelefone(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function gerarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
