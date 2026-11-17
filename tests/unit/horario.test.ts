import assert from "node:assert/strict";
import { test } from "node:test";
import { modoEfetivo, proximaAberturaEm, proximaHora, quandoEmSP, statusDaLoja } from "../../src/lib/horario";
import type { Horarios } from "../../src/lib/tipos";

// Seg–qui 14–21, sex 10–00 (meia-noite), sáb 18–02 (passa da meia-noite), dom fechado
const horarios: Horarios = {
  "1": [{ abre: "14:00", fecha: "21:00" }],
  "2": [{ abre: "14:00", fecha: "21:00" }],
  "3": [{ abre: "14:00", fecha: "21:00" }],
  "4": [{ abre: "14:00", fecha: "21:00" }],
  "5": [{ abre: "10:00", fecha: "00:00" }],
  "6": [{ abre: "18:00", fecha: "02:00" }],
};
// 2026-11-16 é segunda-feira; São Paulo = UTC-3
const sp = (iso: string) => new Date(`${iso}-03:00`);
const cfg = (status_manual: "auto" | "aberta" | "fechada", status_ate: string | null = null) => ({ horarios, status_manual, status_ate });

test("modo forçado com prazo volta sozinho ao automático; sem prazo continua", () => {
  const ate = sp("2026-11-16T12:00").toISOString();
  assert.equal(modoEfetivo(cfg("aberta", ate), sp("2026-11-16T11:59")), "aberta");
  assert.equal(modoEfetivo(cfg("aberta", ate), sp("2026-11-16T12:00")), "auto");
  assert.equal(modoEfetivo(cfg("fechada", ate), sp("2026-11-16T12:30")), "auto");
  assert.equal(modoEfetivo(cfg("aberta"), sp("2026-12-25T04:00")), "aberta");
  assert.equal(modoEfetivo(cfg("fechada"), sp("2026-12-25T04:00")), "fechada");
});

test("forçar aberta fora do horário: aberta até a hora escolhida, depois segue o horário", () => {
  const c = cfg("aberta", sp("2026-11-16T12:00").toISOString());
  assert.deepEqual(statusDaLoja(c, sp("2026-11-16T10:00")), { aberta: true, titulo: "Aberto agora", detalhe: "Aberto até 12h" });
  assert.deepEqual(statusDaLoja(c, sp("2026-11-16T12:01")), { aberta: false, titulo: "Fechado agora", detalhe: "Abre hoje às 14h" });
});

test("forçar aberta até o horário normal emenda com o expediente (mostra quando fecha de verdade)", () => {
  const c = cfg("aberta", sp("2026-11-16T14:00").toISOString());
  assert.equal(statusDaLoja(c, sp("2026-11-16T10:00")).detalhe, "Fecha às 21h");
  assert.equal(statusDaLoja(c, sp("2026-11-16T15:00")).aberta, true);
  assert.equal(statusDaLoja(c, sp("2026-11-16T21:00")).aberta, false);
});

test("forçar aberta depois de fechar, até 2h da madrugada", () => {
  const fim = proximaHora("02:00", sp("2026-11-16T23:10"));
  assert.equal(fim.toISOString(), sp("2026-11-17T02:00").toISOString());
  const c = cfg("aberta", fim.toISOString());
  assert.equal(statusDaLoja(c, sp("2026-11-17T01:59")).detalhe, "Aberto até 2h");
  assert.equal(statusDaLoja(c, sp("2026-11-17T02:00")).aberta, false);
});

test("forçar fechada até a próxima abertura: pausa e volta sozinha", () => {
  const abertura = proximaAberturaEm(horarios, sp("2026-11-16T15:30"));
  assert.equal(abertura?.toISOString(), sp("2026-11-17T14:00").toISOString());
  const c = cfg("fechada", abertura!.toISOString());
  assert.deepEqual(statusDaLoja(c, sp("2026-11-16T15:30")), { aberta: false, titulo: "Fechado agora", detalhe: "Abre amanhã às 14h" });
  assert.equal(statusDaLoja(c, sp("2026-11-17T14:00")).aberta, true);
});

test("forçar fechada sem prazo (férias) não volta sozinha", () => {
  assert.deepEqual(statusDaLoja(cfg("fechada"), sp("2026-11-17T15:00")), { aberta: false, titulo: "Fechado agora", detalhe: "Voltamos em breve" });
});

test("próxima abertura: sábado de madrugada, domingo fechado e sem horário nenhum", () => {
  // Sábado 01h (sexta fechou à meia-noite) -> abre sábado 18h
  assert.equal(proximaAberturaEm(horarios, sp("2026-11-21T01:00"))?.toISOString(), sp("2026-11-21T18:00").toISOString());
  // Domingo 12h -> segunda 14h
  assert.equal(proximaAberturaEm(horarios, sp("2026-11-22T12:00"))?.toISOString(), sp("2026-11-23T14:00").toISOString());
  assert.equal(proximaAberturaEm({}, sp("2026-11-22T12:00")), null);
});

test("textos de quando: hoje, amanhã, dia da semana", () => {
  const agora = sp("2026-11-16T10:00");
  assert.equal(quandoEmSP(sp("2026-11-16T16:30"), agora), "hoje às 16h30");
  assert.equal(quandoEmSP(sp("2026-11-17T02:00"), agora), "amanhã às 2h");
  assert.equal(quandoEmSP(sp("2026-11-20T10:00"), agora), "sexta às 10h");
});

test("automático continua igual: aberta no horário, fechada fora", () => {
  assert.deepEqual(statusDaLoja(cfg("auto"), sp("2026-11-20T23:00")), { aberta: true, titulo: "Aberto agora", detalhe: "Fecha à meia-noite" });
  assert.deepEqual(statusDaLoja(cfg("auto"), sp("2026-11-22T12:00")), { aberta: false, titulo: "Fechado agora", detalhe: "Abre amanhã às 14h" });
});
