import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { FotosPreparadas } from "../src/lib/fotos-preparadas";
import { gerarVersoesFoto } from "./fotos-variantes";

dotenv.config({ path: ".env.local", quiet: true });
const pasta = path.join(process.cwd(), "public", "_fotos");
const manifesto = path.join(process.cwd(), "public", "_fotos-manifest.json");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const fotos: FotosPreparadas = {};

async function preparar() {
  await mkdir(pasta, { recursive: true });
  if (url && chave) {
    const sb = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
    const origem = new URL(url).origin;
    const urls = new Set<string>();
    for (let inicio = 0; ; inicio += 1000) {
      const { data, error } = await sb.from("produtos").select("foto_url").eq("ativo", true).not("foto_url", "is", null).order("id").range(inicio, inicio + 999);
      if (error) throw new Error("Não foi possível consultar as fotos públicas.");
      for (const p of data ?? []) if (p.foto_url) urls.add(p.foto_url);
      if (!data || data.length < 1000) break;
    }
    sharp.concurrency(1);
    sharp.cache({ memory: 32 });
    const fila = [...urls];
    let falhas = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (fila.length) {
        const src = fila.shift()!;
        try {
          const destino = new URL(src);
          if (destino.origin !== origem || !destino.pathname.startsWith("/storage/v1/object/public/") || destino.username || destino.password) continue;
          const resposta = await fetch(src, { redirect: "error", signal: AbortSignal.timeout(20000) });
          if (!resposta.ok) throw new Error("Foto indisponível");
          if (Number(resposta.headers.get("content-length")) > 15 * 1024 * 1024) throw new Error("Foto grande demais");
          const original = Buffer.from(await resposta.arrayBuffer());
          if (original.length > 15 * 1024 * 1024) throw new Error("Foto grande demais");
          const versoes = await gerarVersoesFoto(original);
          for (const v of versoes) await writeFile(path.join(pasta, v.nome), v.conteudo);
          fotos[src] = { src: `/_fotos/${versoes[Math.min(1, versoes.length - 1)].nome}`, srcSet: versoes.map((v) => `/_fotos/${v.nome} ${v.largura}w`).join(", ") };
        } catch { falhas++; }
      }
    }));
    console.log(`[fotos] ${Object.keys(fotos).length} fotos preparadas; ${falhas} indisponíveis usam o carregamento normal.`);
  }
  await writeFile(`${manifesto}.tmp`, JSON.stringify(fotos));
  await rename(`${manifesto}.tmp`, manifesto);
}

preparar().catch(async () => {
  // An unavailable database must not prevent a deployment or erase a prior manifest.
  try { await readFile(manifesto); } catch { await writeFile(manifesto, "{}"); }
  console.warn("[fotos] Preparação indisponível; o carregamento normal das imagens foi mantido.");
});
