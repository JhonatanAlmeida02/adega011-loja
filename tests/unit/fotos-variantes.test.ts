import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { gerarVersoesFoto } from "../../scripts/fotos-variantes";

test("fotos prontas têm três tamanhos WebP, mantêm proporção e preservam original", async () => {
  const original = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "red" } }).png().toBuffer();
  const copia = Buffer.from(original);
  const versoes = await gerarVersoesFoto(original);
  assert.deepEqual(versoes.map((v) => v.largura), [320, 640, 960]);
  for (const v of versoes) {
    const m = await sharp(v.conteudo).metadata();
    assert.equal(m.format, "webp");
    assert.equal(m.width, v.largura);
    assert.equal(m.height, v.largura / 2);
  }
  assert.deepEqual(original, copia);
});

test("fotos pequenas não são ampliadas nem geram versões repetidas", async () => {
  const original = await sharp({ create: { width: 100, height: 150, channels: 3, background: "blue" } }).png().toBuffer();
  const versoes = await gerarVersoesFoto(original);
  assert.equal(versoes.length, 1);
  assert.equal(versoes[0].largura, 100);
  assert.equal((await sharp(versoes[0].conteudo).metadata()).height, 150);
});

test("o nome para cache é estável e muda quando a foto muda", async () => {
  const foto = (cor: string) => sharp({ create: { width: 100, height: 100, channels: 3, background: cor } }).png().toBuffer();
  const original = await foto("red");
  const a = await gerarVersoesFoto(original);
  const b = await gerarVersoesFoto(original);
  const c = await gerarVersoesFoto(await foto("blue"));
  assert.equal(a[0].nome, b[0].nome);
  assert.notEqual(a[0].nome, c[0].nome);
  assert.match(a[0].nome, /^[a-f0-9]{24}-320\.webp$/);
});
