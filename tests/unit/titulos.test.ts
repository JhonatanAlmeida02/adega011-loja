import { test } from "node:test";
import assert from "node:assert/strict";
import { diasEntre, resumoTitulos, situacaoTitulo } from "../../src/lib/titulos";

const hoje = "2026-11-16";
const t = (vencimento: string, status: "aberto" | "pago" | "cancelado" = "aberto", valor = 1000) =>
  ({ tipo: "pagar" as const, status, vencimento, valor, pago_em: status === "pago" ? "2026-11-10" : null });

test("dias entre datas (sem fuso)", () => {
  assert.equal(diasEntre("2026-11-16", "2026-11-23"), 7);
  assert.equal(diasEntre("2026-11-16", "2026-11-15"), -1);
  assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1);
});

test("situação da conta", () => {
  assert.deepEqual(situacaoTitulo(t("2026-11-10"), hoje), { tipo: "vencida", texto: "Vencida há 6 dias" });
  assert.equal(situacaoTitulo(t("2026-11-15"), hoje).texto, "Venceu ontem");
  assert.deepEqual(situacaoTitulo(t("2026-11-16"), hoje), { tipo: "hoje", texto: "Vence hoje" });
  assert.equal(situacaoTitulo(t("2026-11-17"), hoje).texto, "Vence amanhã");
  assert.deepEqual(situacaoTitulo(t("2026-11-20"), hoje), { tipo: "proxima", texto: "Vence em 4 dias" });
  assert.deepEqual(situacaoTitulo(t("2026-12-20"), hoje), { tipo: "em-dia", texto: "Vence em 20/12/2026" });
  assert.deepEqual(situacaoTitulo(t("2026-11-01", "pago"), hoje), { tipo: "paga", texto: "Paga em 10/11/2026" });
  assert.equal(situacaoTitulo({ ...t("2026-11-01", "pago"), tipo: "receber" }, hoje).texto, "Recebida em 10/11/2026");
  assert.equal(situacaoTitulo(t("2026-11-01", "cancelado"), hoje).tipo, "cancelada");
});

test("resumo: vencidas, próximos 7 dias e total em aberto (pagas e canceladas fora)", () => {
  const r = resumoTitulos([t("2026-11-10", "aberto", 100), t("2026-11-16", "aberto", 200), t("2026-11-23", "aberto", 300), t("2026-11-24", "aberto", 400), t("2026-11-01", "pago", 999), t("2026-11-01", "cancelado", 999)], hoje);
  assert.deepEqual(r.vencidas, { quantidade: 1, valor: 100 });
  assert.deepEqual(r.proximas, { quantidade: 2, valor: 500 });
  assert.deepEqual(r.abertas, { quantidade: 4, valor: 1000 });
});
