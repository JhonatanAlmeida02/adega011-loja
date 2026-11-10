"use client";

import { BUCKET_FOTOS } from "@/lib/supabase/config";
import { supabaseNavegador } from "@/lib/supabase/navegador";

/**
 * Reduz a foto no navegador antes do upload (máx. 1400 px, WebP),
 * deixando a vitrine leve mesmo com fotos tiradas pelo celular.
 */
export async function comprimirImagem(arquivo: File, max = 1400, qualidade = 0.84): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", qualidade));
  if (!blob) throw new Error("Não foi possível processar a imagem.");
  return blob;
}

/** Envia a imagem para o bucket e devolve a URL pública. */
export async function enviarImagem(arquivo: File, pasta: "produtos" | "banner"): Promise<string> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (arquivo.size > 15 * 1024 * 1024) throw new Error("Imagem muito grande (máx. 15 MB).");
  let blob: Blob;
  let extensao = "webp";
  try {
    blob = await comprimirImagem(arquivo, pasta === "banner" ? 2000 : 1400);
  } catch {
    // O navegador não conseguiu ler a imagem para reduzir: envia o original se for um formato aceito.
    const aceitos: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
    if (!aceitos[arquivo.type] || arquivo.size > 5 * 1024 * 1024) {
      throw new Error("Não foi possível ler essa imagem. Use uma foto em JPG, PNG ou WebP.");
    }
    blob = arquivo;
    extensao = aceitos[arquivo.type];
  }
  const caminho = `${pasta}/${crypto.randomUUID()}.${extensao}`;
  const sb = supabaseNavegador();
  const { error } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, blob, {
    contentType: blob.type || "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Falha no upload: ${error.message}`);
  return sb.storage.from(BUCKET_FOTOS).getPublicUrl(caminho).data.publicUrl;
}

/** Remove do bucket uma imagem enviada pelo painel (ignora URLs externas/locais). */
export async function removerImagem(url: string | null | undefined) {
  if (!url) return;
  const marcador = `/storage/v1/object/public/${BUCKET_FOTOS}/`;
  const i = url.indexOf(marcador);
  if (i === -1) return;
  await supabaseNavegador().storage.from(BUCKET_FOTOS).remove([url.slice(i + marcador.length)]);
}
