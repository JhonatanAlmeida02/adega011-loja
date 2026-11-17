/**
 * IP de quem chamou. cf-connecting-ip e sb-forwarded-for são postos pela
 * Cloudflare do Supabase e não dá para falsificar. O COMEÇO do x-forwarded-for
 * o cliente inventa ("1.2.3.4, ip-real"), então dele só vale o último item.
 */
export function ipDoCliente(h: Headers): string | null {
  const lista = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (h.get("cf-connecting-ip")?.trim() || h.get("sb-forwarded-for")?.trim() || lista[lista.length - 1] || "").slice(0, 64) || null;
}
