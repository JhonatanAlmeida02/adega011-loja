import { test } from "node:test";
import assert from "node:assert/strict";
import { tempoRestante } from "../../src/lib/pix";

test("tempo restante do Pix em mm:ss, sem negativo", () => {
  const agora = Date.parse("2026-11-15T12:00:00Z");
  assert.equal(tempoRestante("2026-11-15T12:30:00Z", agora), "30:00");
  assert.equal(tempoRestante("2026-11-15T12:01:05Z", agora), "01:05");
  assert.equal(tempoRestante("2026-11-15T11:59:00Z", agora), "00:00");
});
