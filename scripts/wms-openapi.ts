/**
 * Gera docs/wms/openapi.json a partir do registro de rotas (src/lib/wms/rotas.ts).
 *   npx tsx scripts/wms-openapi.ts
 */
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { COMANDOS, CONSULTAS } from "../src/lib/wms/rotas";

const caminho = (c: string) => "/api/wms/" + c.replace(/:([a-z_]+)/g, "{$1}");
const parametros = (c: string) =>
  [...c.matchAll(/:([a-z_]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string", format: "uuid" } }));

const erros = {
  "401": { description: "Sem autenticação ou sessão expirada" },
  "403": { description: "Sem permissão, fora do escopo de empresa/armazém, MFA exigido ou origem inválida" },
  "404": { description: "Registro não encontrado" },
  "409": { description: "Conflito de estado, versão, saldo ou chave de idempotência reutilizada com outro conteúdo" },
  "422": { description: "Entrada inválida" },
  "429": { description: "Muitas requisições" },
};

const paths: Record<string, Record<string, unknown>> = {};
for (const c of COMANDOS) {
  const p = caminho(c.caminho);
  paths[p] ??= {};
  paths[p].post = {
    summary: `Executa wms.${c.fn}`,
    operationId: c.fn,
    parameters: [
      ...parametros(c.caminho),
      ...(c.semChave ? [] : [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,200}$" },
        description: "Mesma chave + mesmo conteúdo devolve o resultado anterior; conteúdo diferente = 409." }]),
      { name: "x-correlation-id", in: "header", required: false, schema: { type: "string" } },
    ],
    requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(c.schema, { io: "input", unrepresentable: "any" }) } } },
    responses: { "200": { description: "Resultado do comando (JSON). Repetição idempotente inclui replayed=true." }, ...erros },
  };
}
for (const q of CONSULTAS) {
  const p = caminho(q.caminho);
  paths[p] ??= {};
  paths[p].get = {
    summary: `Consulta ${q.caminho} (RLS: só o que o usuário pode ver)`,
    operationId: `get_${q.caminho.replace(/[/:-]+/g, "_")}`,
    parameters: [...parametros(q.caminho),
      { name: "warehouse_id", in: "query", schema: { type: "string", format: "uuid" } },
      { name: "pagina", in: "query", schema: { type: "integer", minimum: 1 } },
      { name: "limite", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } }],
    responses: { "200": { description: "Dados" }, ...erros },
  };
}
paths["/api/wms/admin/members/invite"] = { post: { summary: "Convida usuário (Supabase Auth) e grava vínculo (users.manage + MFA)", responses: { "200": { description: "Convidado" }, ...erros } } };
paths["/api/integrations/olist/authorize"] = { post: { summary: "Inicia OAuth da Olist (integrations.manage + MFA); devolve a URL de autorização", responses: { "200": { description: "URL" }, ...erros } } };
paths["/api/integrations/olist/callback"] = { get: { summary: "Retorno do OAuth (state de uso único, mesmo administrador)", responses: { "302": { description: "Redireciona para /wms/integracoes" } } } };
paths["/api/webhooks/olist/{connectionRef}"] = { post: {
  summary: "Recebe aviso da Olist; grava na inbox e só então responde 200. Sinal não confiável: o worker consulta a API autenticada.",
  parameters: [{ name: "connectionRef", in: "path", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
    { name: "tipo", in: "query", required: true, schema: { type: "string", enum: ["vendas", "enviados", "estoque", "notas"] } }],
  responses: { "200": { description: "Persistido (ou duplicado)" }, "400": { description: "Tipo/JSON inválido" }, "404": { description: "Conexão desconhecida" }, "503": { description: "Não persistido: a Olist reenviará" } } } };
paths["/api/wms-saude"] = { get: { summary: "Health check (banco e idade das filas)", responses: { "200": { description: "OK" }, "503": { description: "Fila parada, banco indisponível ou reautorização pendente" } } } };

const doc = {
  openapi: "3.1.0",
  info: { title: "WMS · API interna", version: "1.0.0", description: "Rotas do WMS (não são endpoints da Olist). Autenticação: sessão Supabase (cookie) ou Authorization: Bearer <JWT>." },
  paths,
};
writeFileSync("docs/wms/openapi.json", JSON.stringify(doc, null, 2) + "\n");
console.log(`docs/wms/openapi.json: ${Object.keys(paths).length} caminhos`);
