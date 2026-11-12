import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cidadeComUf, lerRespostaCep, mascararCep } from "../../src/lib/cep";

test("máscara do CEP enquanto digita", () => {
  assert.equal(mascararCep("1325"), "1325");
  assert.equal(mascararCep("132500"), "13250-0");
  assert.equal(mascararCep("13250-000"), "13250-000");
  assert.equal(mascararCep("13.250-000xx99"), "13250-000");
});

test("lê a resposta do ViaCEP", () => {
  const e = lerRespostaCep(
    { cep: "13250-000", logradouro: "Rua Coronel Camilo Pires", bairro: "Centro", localidade: "Itatiba", uf: "SP" },
    "13250000",
  );
  assert.deepEqual(e, { cep: "13250-000", rua: "Rua Coronel Camilo Pires", bairro: "Centro", cidade: "Itatiba", uf: "SP" });
  assert.equal(cidadeComUf(e!), "Itatiba - SP");
});

test("lê a resposta da BrasilAPI e trata CEP inexistente", () => {
  const e = lerRespostaCep({ cep: "13250000", street: "Rua X", neighborhood: "Bairro Y", city: "Itatiba", state: "SP" }, "13250000");
  assert.equal(e?.rua, "Rua X");
  assert.equal(e?.bairro, "Bairro Y");
  assert.equal(lerRespostaCep({ erro: true }, "99999999"), null);
  assert.equal(lerRespostaCep({ erro: "true" }, "99999999"), null);
});

test("cidade com CEP único: sem rua, mas com cidade", () => {
  const e = lerRespostaCep({ logradouro: "", bairro: "", localidade: "Morungaba", uf: "SP" }, "13260000");
  assert.equal(e?.rua, "");
  assert.equal(e?.cidade, "Morungaba");
});
