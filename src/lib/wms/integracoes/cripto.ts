/**
 * Cifragem dos tokens do ERP (AES-256-GCM). A chave fica FORA do banco (variável
 * de ambiente do servidor/worker); o banco só guarda o texto cifrado.
 * Rotação: INTEGRATION_ENCRYPTION_KEY (atual, versão INTEGRATION_ENCRYPTION_KEY_VERSION)
 * e INTEGRATION_ENCRYPTION_KEY_PREVIOUS ("versão:base64") para ler o que ainda não foi recifrado.
 * O ID da conexão entra como dado autenticado: um texto cifrado não serve em outra conexão.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type Chave = { versao: number; chave: Buffer };

function lerChave(b64: string, origem: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error(`${origem} deve ter 32 bytes em base64.`);
  return k;
}

export function chavesDeCifragem(env: NodeJS.ProcessEnv = process.env): { atual: Chave; todas: Map<number, Buffer> } {
  const b64 = env.INTEGRATION_ENCRYPTION_KEY;
  if (!b64) throw new Error("INTEGRATION_ENCRYPTION_KEY não configurada.");
  const versao = Number(env.INTEGRATION_ENCRYPTION_KEY_VERSION ?? 1);
  const todas = new Map<number, Buffer>([[versao, lerChave(b64, "INTEGRATION_ENCRYPTION_KEY")]]);
  for (const item of (env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS ?? "").split(",").filter(Boolean)) {
    const [v, k] = item.split(":");
    todas.set(Number(v), lerChave(k, "INTEGRATION_ENCRYPTION_KEY_PREVIOUS"));
  }
  return { atual: { versao, chave: todas.get(versao)! }, todas };
}

export function cifrar(texto: string, contexto: string, env: NodeJS.ProcessEnv = process.env): { ciphertext: string; versao: number } {
  const { atual } = chavesDeCifragem(env);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", atual.chave, iv);
  c.setAAD(Buffer.from(contexto));
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return { ciphertext: `v${atual.versao}.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`, versao: atual.versao };
}

export function decifrar(ciphertext: string, contexto: string, env: NodeJS.ProcessEnv = process.env): string {
  const [v, ivB64, tagB64, ctB64] = ciphertext.split(".");
  const versao = Number(v?.slice(1));
  const chave = chavesDeCifragem(env).todas.get(versao);
  if (!chave) throw new Error(`Chave de cifragem versão ${versao} indisponível.`);
  const d = createDecipheriv("aes-256-gcm", chave, Buffer.from(ivB64, "base64"));
  d.setAAD(Buffer.from(contexto));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
}

export const hashSha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const aleatorioUrl = (bytes = 32) => randomBytes(bytes).toString("base64url");
