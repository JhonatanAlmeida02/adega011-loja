import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

/**
 * Baixa uma imagem de um link público, valida e converte para WebP leve.
 * Usado pelo painel ("Colar link da imagem"). Como o servidor busca uma URL
 * informada por alguém, há proteções contra acesso à rede interna (SSRF):
 * só http/https, só IPs públicos (checado a cada redirecionamento),
 * tamanho máximo, tempo limite e conteúdo que precisa ser imagem de verdade.
 */

const TAMANHO_MAXIMO = 10 * 1024 * 1024; // 10 MB baixados
const TEMPO_LIMITE_MS = 12_000;
const MAX_REDIRECIONAMENTOS = 3;

export class ErroImportacao extends Error {}

function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / metadados de nuvem
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast e reservados
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return ipPrivado(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") || // unique local
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") || // link-local
    v6.startsWith("ff") // multicast
  );
}

async function validarDestino(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ErroImportacao("Use um link que comece com https://");
  }
  if (url.username || url.password) throw new ErroImportacao("Link inválido.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ErroImportacao("Esse endereço não é permitido.");
  }
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (enderecos.length === 0) throw new ErroImportacao("Não encontramos esse site. Confira o link.");
  if (enderecos.some((e) => ipPrivado(e.address))) {
    throw new ErroImportacao("Esse endereço não é permitido.");
  }
}

async function baixar(link: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new ErroImportacao("Link inválido. Copie o endereço completo da imagem.");
  }

  for (let i = 0; i <= MAX_REDIRECIONAMENTOS; i++) {
    await validarDestino(url);
    const resp = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
    }).catch(() => {
      throw new ErroImportacao("Não conseguimos acessar esse link. Tente outro.");
    });

    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      url = new URL(resp.headers.get("location")!, url);
      continue;
    }
    if (!resp.ok) throw new ErroImportacao(`O site respondeu com erro (${resp.status}). Tente outro link.`);

    const tipo = resp.headers.get("content-type") ?? "";
    if (!tipo.startsWith("image/")) {
      throw new ErroImportacao(
        "Esse link é de uma página, não de uma imagem. Abra a foto, clique com o botão direito e use “Copiar endereço da imagem”.",
      );
    }
    const declarado = Number(resp.headers.get("content-length") ?? 0);
    if (declarado > TAMANHO_MAXIMO) throw new ErroImportacao("Imagem muito grande (máx. 10 MB).");

    // Lê com limite, mesmo que o servidor não informe o tamanho.
    const leitor = resp.body?.getReader();
    if (!leitor) throw new ErroImportacao("Imagem vazia.");
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > TAMANHO_MAXIMO) {
        await leitor.cancel();
        throw new ErroImportacao("Imagem muito grande (máx. 10 MB).");
      }
      partes.push(value);
    }
    return Buffer.concat(partes);
  }
  throw new ErroImportacao("Redirecionamentos demais nesse link.");
}

/** Baixa e devolve a imagem já reduzida (lado maior ≤ `max` px) em WebP. */
export async function baixarImagemOtimizada(link: string, max: number): Promise<Buffer> {
  const original = await baixar(link);
  try {
    return await sharp(original, { limitInputPixels: 40_000_000, animated: false })
      .rotate() // respeita a orientação da câmera
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ErroImportacao("Não conseguimos ler essa imagem. Tente uma foto em JPG, PNG ou WebP.");
  }
}
