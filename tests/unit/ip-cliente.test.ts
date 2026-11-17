import { test } from "node:test";
import assert from "node:assert/strict";
import { ipDoCliente } from "../../supabase/functions/cotar-frete/ip";

test("IP do cliente: usa o da Cloudflare e ignora o começo inventado do x-forwarded-for", () => {
  assert.equal(ipDoCliente(new Headers({ "cf-connecting-ip": "200.1.1.1", "x-forwarded-for": "1.2.3.4, 200.1.1.1" })), "200.1.1.1");
  assert.equal(ipDoCliente(new Headers({ "sb-forwarded-for": "200.3.3.3", "x-forwarded-for": "1.2.3.4,200.3.3.3" })), "200.3.3.3");
  // Sem os cabeçalhos da Cloudflare: o último item é o que o proxy acrescentou
  assert.equal(ipDoCliente(new Headers({ "x-forwarded-for": "1.2.3.4,  200.9.9.9" })), "200.9.9.9");
  assert.equal(ipDoCliente(new Headers({ "x-forwarded-for": "200.9.9.9" })), "200.9.9.9");
  assert.equal(ipDoCliente(new Headers()), null);
});
