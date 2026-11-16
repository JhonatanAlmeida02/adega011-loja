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

import { fimDoMes, intervaloPeriodo, nomeDoMes, noPeriodo, semanasDoMes, somarMeses } from "../../src/lib/titulos";

test("meses: somar, último dia e nome", () => {
  assert.equal(somarMeses("2026-11", 1), "2026-12");
  assert.equal(somarMeses("2026-12", 1), "2027-01");
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(fimDoMes("2028-02"), "2028-02-29");
  assert.equal(nomeDoMes("2026-11"), "Novembro de 2026");
});

test("semanas do calendário: domingo a sábado cobrindo o mês", () => {
  const s = semanasDoMes("2026-11"); // 1/11/2026 é domingo; 30/11 segunda
  assert.equal(s[0][0].data, "2026-11-01");
  assert.equal(s.length, 5);
  assert.ok(s.every((sem) => sem.length === 7));
  assert.deepEqual(s[4].at(-1), { data: "2026-12-05", doMes: false });
  const f = semanasDoMes("2027-02"); // 1/2/2027 é segunda: começa no domingo 31/1
  assert.deepEqual(f[0][0], { data: "2027-01-31", doMes: false });
  assert.equal(f.flat().filter((d) => d.doMes).length, 28);
});

test("período: este mês, próximo, ano e filtro (vencidas anteriores continuam)", () => {
  const hoje = "2026-11-16";
  assert.deepEqual(intervaloPeriodo("mes", hoje), { de: "2026-11-01", ate: "2026-11-30" });
  assert.deepEqual(intervaloPeriodo("proximo", hoje), { de: "2026-12-01", ate: "2026-12-31" });
  assert.deepEqual(intervaloPeriodo("ano", hoje), { de: "2026-01-01", ate: "2026-12-31" });
  assert.deepEqual(intervaloPeriodo("tudo", hoje), { de: null, ate: null });
  const dez = intervaloPeriodo("proximo", hoje);
  const conta = (vencimento: string, status: "aberto" | "pago" = "aberto", pago_em: string | null = null) => ({ vencimento, status, pago_em });
  assert.equal(noPeriodo(conta("2026-12-05"), dez, hoje), true);
  assert.equal(noPeriodo(conta("2027-01-05"), dez, hoje), false);
  assert.equal(noPeriodo(conta("2026-11-20"), dez, hoje), false); // ainda não venceu e é de outro mês
  assert.equal(noPeriodo(conta("2026-10-05"), dez, hoje), true); // vencida e em aberto: continua aparecendo
  assert.equal(noPeriodo(conta("2026-12-05", "pago", "2026-11-10"), dez, hoje), false); // paga: vale a data do pagamento
});
