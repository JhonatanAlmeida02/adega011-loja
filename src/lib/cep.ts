/**
 * Busca de endereço pelo CEP (gratuita, sem chave): ViaCEP e, se ele falhar,
 * BrasilAPI. Roda no navegador do cliente.
 */
export interface EnderecoCep {
  cep: string; // "13250-000"
  rua: string; // pode vir vazio em cidades com CEP único
  bairro: string;
  cidade: string; // "Itatiba"
  uf: string; // "SP"
}

export type ResultadoCep = { ok: true; endereco: EnderecoCep } | { ok: false; erro: string };

export const soDigitosCep = (v: string) => v.replace(/\D/g, "").slice(0, 8);

/** "13250000" -> "13250-000" (formata enquanto digita) */
export function mascararCep(v: string): string {
  const d = soDigitosCep(v);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Cidade no formato usado no checkout e no cálculo do frete: "Itatiba - SP" */
export const cidadeComUf = (e: Pick<EnderecoCep, "cidade" | "uf">) => (e.uf ? `${e.cidade} - ${e.uf}` : e.cidade);

const limpar = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Converte a resposta do ViaCEP ou da BrasilAPI (formatos diferentes). */
export function lerRespostaCep(dados: unknown, cep: string): EnderecoCep | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Record<string, unknown>;
  if (d.erro === true || d.erro === "true") return null;
  const cidade = limpar(d.localidade) || limpar(d.city);
  const uf = limpar(d.uf) || limpar(d.state);
  if (!cidade) return null;
  return {
    cep: mascararCep(cep),
    rua: limpar(d.logradouro) || limpar(d.street),
    bairro: limpar(d.bairro) || limpar(d.neighborhood),
    cidade,
    uf,
  };
}

async function consultar(url: string, cep: string): Promise<EnderecoCep | null | "falha"> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) return "falha";
    return lerRespostaCep(await r.json(), cep);
  } catch {
    return "falha";
  }
}

export async function buscarCep(valor: string): Promise<ResultadoCep> {
  const cep = soDigitosCep(valor);
  if (cep.length !== 8) return { ok: false, erro: "Digite os 8 números do CEP." };
  let r = await consultar(`https://viacep.com.br/ws/${cep}/json/`, cep);
  if (r === "falha") r = await consultar(`https://brasilapi.com.br/api/cep/v1/${cep}`, cep);
  if (r === "falha") return { ok: false, erro: "Não conseguimos buscar o CEP agora. Preencha o endereço abaixo." };
  if (!r) return { ok: false, erro: "CEP não encontrado. Confira os números ou preencha o endereço abaixo." };
  return { ok: true, endereco: r };
}
