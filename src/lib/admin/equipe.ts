import type { Papel } from "./sessao";

export type MembroEquipe = {
  user_id: string;
  email: string;
  nome: string;
  papel: Papel;
  criado_em: string;
  ultimo_acesso: string | null;
};

export const PAPEIS: Record<Papel, { nome: string; descricao: string }> = {
  admin: { nome: "Administrador", descricao: "Vê e altera tudo: produtos, estoque, financeiro, relatórios, configurações e usuários." },
  operador: { nome: "Operador", descricao: "Só Pedidos e PDV: acompanha pedidos, muda o status, abre/fecha o caixa e vende no balcão." },
};

/** Mesma regra da Edge Function "equipe": 8 a 72 caracteres, com letra e número. */
export function problemaNaSenha(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return "Use letras e números na senha.";
  return null;
}

export function emailValido(email: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email.trim());
}

/** Ordena: administradores primeiro, depois por nome (ou e-mail). */
export function ordenarEquipe(lista: MembroEquipe[]): MembroEquipe[] {
  return [...lista].sort(
    (a, b) =>
      (a.papel === b.papel ? 0 : a.papel === "admin" ? -1 : 1) ||
      (a.nome || a.email).localeCompare(b.nome || b.email, "pt-BR", { sensitivity: "base" }),
  );
}
