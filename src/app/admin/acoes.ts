"use server";

import { updateTag } from "next/cache";
import { TAG_LOJA } from "@/lib/loja";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { supabaseServidor } from "@/lib/supabase/servidor";

/**
 * Atualiza a vitrine na hora depois que o admin salva algo.
 * Confere a sessão e a permissão de admin aqui dentro (não confia no cliente).
 */
export async function revalidarLoja(): Promise<{ ok: boolean }> {
  if (!supabaseConfigurado) return { ok: false };
  const sb = await supabaseServidor();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false };
  const { data } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) return { ok: false };
  updateTag(TAG_LOJA);
  return { ok: true };
}
