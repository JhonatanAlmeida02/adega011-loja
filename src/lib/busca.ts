/** Normaliza texto para busca: minúsculas e sem acentos. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Todas as palavras digitadas precisam aparecer no texto. */
export function combina(texto: string, termo: string): boolean {
  const alvo = normalizar(texto);
  return normalizar(termo)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => alvo.includes(p));
}
