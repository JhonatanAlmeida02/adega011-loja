"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { revalidarLoja } from "@/app/admin/acoes";
import { supabaseNavegador } from "@/lib/supabase/navegador";

/** Carrega uma tabela inteira (ordenada) para as telas do painel. */
export function useTabela<T>(tabela: string, colunas = "*", ordem = "ordem") {
  const [dados, setDados] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    supabaseNavegador()
      .from(tabela)
      .select(colunas)
      .order(ordem)
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) toast.error(`Erro ao carregar: ${error.message}`);
        setDados((data ?? []) as T[]);
        setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [tabela, colunas, ordem, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { dados, setDados, carregando, recarregar };
}

/**
 * Executa uma alteração no banco, mostra o resultado e atualiza a vitrine.
 * Retorna true se deu certo.
 */
export async function salvar(
  operacao: PromiseLike<{ error: { message: string } | null }>,
  mensagem: string | null = "Salvo!",
): Promise<boolean> {
  const { error } = await operacao;
  if (error) {
    toast.error(traduzirErro(error.message));
    return false;
  }
  // Espera a vitrine ser atualizada antes de confirmar, para "Salvo" valer também na loja.
  await revalidarLoja().catch(() => null);
  if (mensagem) toast.success(mensagem);
  return true;
}

function traduzirErro(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return "Sem permissão. Entre novamente como administrador.";
  if (/duplicate key/i.test(msg)) return "Já existe um registro com esse nome.";
  if (/JWT|session/i.test(msg)) return "Sua sessão expirou. Entre novamente.";
  return `Não foi possível salvar: ${msg}`;
}
