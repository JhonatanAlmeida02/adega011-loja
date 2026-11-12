import { createHash } from "node:crypto";
import sharp from "sharp";

/** Geração durante o build: nunca amplia fotos pequenas nem altera o original. */
export async function gerarVersoesFoto(original: Buffer) {
  const hash = createHash("sha256").update("webp-78-v1").update(original).digest("hex").slice(0, 24);
  const versoes = new Map<number, { nome: string; conteudo: Buffer }>();
  for (const largura of [320, 640, 960]) {
    const { data, info } = await sharp(original, { limitInputPixels: 40000000 }).rotate()
      .resize({ width: largura, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (!versoes.has(info.width)) versoes.set(info.width, { nome: `${hash}-${largura}.webp`, conteudo: data });
  }
  return [...versoes.entries()].sort(([a], [b]) => a - b).map(([largura, arquivo]) => ({ largura, ...arquivo }));
}
