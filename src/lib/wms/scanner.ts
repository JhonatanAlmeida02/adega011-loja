/**
 * Leitura de código de barras (coletor/leitor USB que "digita" + terminador).
 * - Nunca converte para número: zeros à esquerda preservados.
 * - Terminador configurável (Enter, Tab ou nenhum).
 * - GS1-128/DataMatrix: (01) GTIN, (10) lote, (17) validade AAMMDD, (21) série.
 * - Cada leitura intencional recebe um ID próprio; retentativa de rede reutiliza o ID.
 *   Não deduplica por código: duas leituras iguais podem ser duas unidades.
 */

export type Terminador = "enter" | "tab" | "nenhum";

export type LeituraGs1 = { gtin?: string; lote?: string; validade?: string; serie?: string; quantidade?: number };

const GS = "\u001d";

export function limparLeitura(bruto: string, terminador: Terminador = "enter"): string {
  let s = bruto;
  if (terminador === "enter") s = s.replace(/[\r\n]+$/, "");
  if (terminador === "tab") s = s.replace(/\t+$/, "");
  // Remove só espaços/controles nas pontas; preserva GS (separador GS1) e zeros.
  return s.replace(/^[\s\u0000-\u001c\u001e\u001f]+|[\s\u0000-\u001c\u001e\u001f]+$/g, "");
}

/** Dígito verificador GTIN-8/12/13/14 (módulo 10). */
export function gtinValido(codigo: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(codigo)) return false;
  const digitos = codigo.split("").map(Number);
  const dv = digitos.pop()!;
  const soma = digitos.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

const AI_FIXOS: Record<string, number> = { "01": 14, "02": 14, "17": 6, "11": 6, "15": 6 };
const AI_VARIAVEIS = new Set(["10", "21", "30", "37"]);

/** Interpreta GS1 com ou sem parênteses; devolve null se não for GS1. */
export function interpretarGs1(entrada: string): LeituraGs1 | null {
  let s = entrada.replace(/^\]([CdQe])\d/, ""); // identificador de simbologia (]C1, ]d2...)
  if (s.startsWith("(")) {
    const r: LeituraGs1 = {};
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    let achou = false;
    while ((m = re.exec(s))) {
      achou = true;
      aplicarAi(r, m[1], m[2]);
    }
    return achou ? r : null;
  }
  if (!/^(01|02)\d{14}/.test(s)) return null;
  const r: LeituraGs1 = {};
  while (s.length) {
    const ai = s.slice(0, 2);
    if (AI_FIXOS[ai]) {
      aplicarAi(r, ai, s.slice(2, 2 + AI_FIXOS[ai]));
      s = s.slice(2 + AI_FIXOS[ai]);
    } else if (AI_VARIAVEIS.has(ai)) {
      const fim = s.indexOf(GS, 2);
      aplicarAi(r, ai, fim === -1 ? s.slice(2) : s.slice(2, fim));
      s = fim === -1 ? "" : s.slice(fim + 1);
    } else {
      break; // AI não suportado: para sem inventar
    }
    if (s.startsWith(GS)) s = s.slice(1);
  }
  return r;
}

function aplicarAi(r: LeituraGs1, ai: string, valor: string) {
  if (ai === "01" || ai === "02") r.gtin = valor.length === 14 && valor.startsWith("0") ? valor.slice(1) : valor;
  else if (ai === "10") r.lote = valor;
  else if (ai === "21") r.serie = valor;
  else if (ai === "30" || ai === "37") r.quantidade = Number(valor);
  else if (ai === "17") {
    const [aa, mm, dd] = [valor.slice(0, 2), valor.slice(2, 4), valor.slice(4, 6)];
    const ano = 2000 + Number(aa);
    // Dia 00 = último dia do mês (regra GS1)
    const dia = dd === "00" ? new Date(Date.UTC(ano, Number(mm), 0)).getUTCDate() : Number(dd);
    r.validade = `${ano}-${mm}-${String(dia).padStart(2, "0")}`;
  }
}

/** Resultado normalizado de uma leitura para enviar ao servidor. */
export function interpretarLeitura(bruto: string, terminador: Terminador = "enter") {
  const codigo = limparLeitura(bruto, terminador);
  const gs1 = interpretarGs1(codigo);
  return {
    codigo: gs1?.gtin ?? codigo,
    lote: gs1?.lote,
    validade: gs1?.validade,
    serie: gs1?.serie,
    quantidade: gs1?.quantidade,
    gtinValido: gtinValido(gs1?.gtin ?? codigo),
  };
}

/** ID da leitura: gerado uma vez por leitura intencional e reutilizado nas retentativas. */
export function novoIdLeitura(): string {
  return crypto.randomUUID();
}
