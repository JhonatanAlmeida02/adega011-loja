import { test } from "node:test";
import assert from "node:assert/strict";
import { emailValido, ordenarEquipe, problemaNaSenha, type MembroEquipe } from "../../src/lib/admin/equipe";
import { podeAbrir } from "../../src/lib/admin/sessao";

test("operador só abre Pedidos e PDV; admin abre tudo", () => {
  assert.equal(podeAbrir("operador", "/admin"), true);
  assert.equal(podeAbrir("operador", "/admin/pdv"), true);
  for (const tela of ["/admin/produtos", "/admin/relatorios", "/admin/financeiro", "/admin/usuarios", "/admin/pdvx", "/admin/loja"]) {
    assert.equal(podeAbrir("operador", tela), false, tela);
    assert.equal(podeAbrir("admin", tela), true, tela);
  }
});

test("senha: 8 a 72 caracteres, com letra e número", () => {
  assert.match(problemaNaSenha("abc123") ?? "", /8/);
  assert.match(problemaNaSenha("somenteletras") ?? "", /letras e números/);
  assert.match(problemaNaSenha("12345678") ?? "", /letras e números/);
  assert.match(problemaNaSenha(`a1${"x".repeat(71)}`) ?? "", /72/);
  assert.equal(problemaNaSenha("Operador123"), null);
});

test("e-mail e ordem da equipe (admins primeiro, por nome)", () => {
  assert.equal(emailValido(" maria@adega.com "), true);
  assert.equal(emailValido("maria@adega"), false);
  const m = (nome: string, papel: "admin" | "operador"): MembroEquipe => ({ user_id: nome, email: `${nome}@x.com`, nome, papel, criado_em: "", ultimo_acesso: null });
  assert.deepEqual(ordenarEquipe([m("Zé", "operador"), m("Bia", "operador"), m("Ana", "admin")]).map((x) => x.nome), ["Ana", "Bia", "Zé"]);
});
