/**
 * Gera supabase/seed.sql a partir de src/lib/dados-exemplo.ts
 * (assim o seed SQL e o modo demonstração usam exatamente os mesmos dados).
 *
 *   npm run seed:sql
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATEGORIAS_EXEMPLO,
  CONFIG_EXEMPLO,
  PRODUTOS_EXEMPLO,
  REGIOES_EXEMPLO,
} from "../src/lib/dados-exemplo";

const q = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const c = CONFIG_EXEMPLO;
const grupos = PRODUTOS_EXEMPLO.flatMap((p) => p.grupos ?? []);
const linhas: string[] = [
  "-- Gerado por scripts/gerar-seed-sql.ts — não edite à mão.",
  "-- Dados de exemplo: categorias, produtos (com adicionais), regiões e configuração da loja.",
  "-- Pode rodar mais de uma vez (faz upsert).",
  "",
  `insert into public.configuracoes (id, nome, slogan, whatsapp, endereco, instagram, horarios, status_manual, pedido_minimo, aceita_entrega, aceita_retirada, pagamentos, chave_pix, tempo_entrega, banner_titulo, banner_texto, banner_botao_texto, banner_botao_link, banner_imagem_url, modo_frete, taxa_base, taxa_por_km, raio_maximo_km, cidade_padrao)`,
  `values (1, ${q(c.nome)}, ${q(c.slogan)}, ${q(c.whatsapp)}, ${q(c.endereco)}, ${q(c.instagram)}, ${q(JSON.stringify(c.horarios))}::jsonb, ${q(c.status_manual)}, ${c.pedido_minimo}, ${q(c.aceita_entrega)}, ${q(c.aceita_retirada)}, array[${c.pagamentos.map(q).join(", ")}], ${q(c.chave_pix)}, ${q(c.tempo_entrega)}, ${q(c.banner_titulo)}, ${q(c.banner_texto)}, ${q(c.banner_botao_texto)}, ${q(c.banner_botao_link)}, ${q(c.banner_imagem_url)}, ${q(c.modo_frete)}, ${c.taxa_base}, ${c.taxa_por_km}, ${c.raio_maximo_km}, ${q(c.cidade_padrao)})`,
  `on conflict (id) do update set modo_frete = excluded.modo_frete, taxa_base = excluded.taxa_base, taxa_por_km = excluded.taxa_por_km, raio_maximo_km = excluded.raio_maximo_km, cidade_padrao = excluded.cidade_padrao, nome = excluded.nome, slogan = excluded.slogan, whatsapp = excluded.whatsapp, endereco = excluded.endereco, instagram = excluded.instagram, horarios = excluded.horarios, status_manual = excluded.status_manual, pedido_minimo = excluded.pedido_minimo, aceita_entrega = excluded.aceita_entrega, aceita_retirada = excluded.aceita_retirada, pagamentos = excluded.pagamentos, chave_pix = excluded.chave_pix, tempo_entrega = excluded.tempo_entrega, banner_titulo = excluded.banner_titulo, banner_texto = excluded.banner_texto, banner_botao_texto = excluded.banner_botao_texto, banner_botao_link = excluded.banner_botao_link, banner_imagem_url = excluded.banner_imagem_url;`,
  "",
  "insert into public.categorias (id, nome, slug, ordem, ativa) values",
  CATEGORIAS_EXEMPLO.map((x) => `  (${q(x.id)}, ${q(x.nome)}, ${q(x.slug)}, ${x.ordem}, ${q(x.ativa)})`).join(",\n"),
  "on conflict (id) do update set nome = excluded.nome, slug = excluded.slug, ordem = excluded.ordem, ativa = excluded.ativa;",
  "",
  "insert into public.produtos (id, categoria_id, nome, descricao, preco, foto_url, destaque, disponivel, ativo, ordem) values",
  PRODUTOS_EXEMPLO.map(
    (x) =>
      `  (${q(x.id)}, ${q(x.categoria_id)}, ${q(x.nome)}, ${q(x.descricao)}, ${x.preco}, ${q(x.foto_url)}, ${q(x.destaque)}, ${q(x.disponivel)}, ${q(x.ativo)}, ${x.ordem})`,
  ).join(",\n"),
  "on conflict (id) do update set categoria_id = excluded.categoria_id, nome = excluded.nome, descricao = excluded.descricao, preco = excluded.preco, foto_url = excluded.foto_url, destaque = excluded.destaque, disponivel = excluded.disponivel, ativo = excluded.ativo, ordem = excluded.ordem;",
  "",
  "insert into public.grupos_opcoes (id, produto_id, nome, minimo, maximo, ordem) values",
  grupos.map((g) => `  (${q(g.id)}, ${q(g.produto_id)}, ${q(g.nome)}, ${g.minimo}, ${g.maximo}, ${g.ordem})`).join(",\n"),
  "on conflict (id) do update set nome = excluded.nome, minimo = excluded.minimo, maximo = excluded.maximo, ordem = excluded.ordem;",
  "",
  "insert into public.opcoes (id, grupo_id, nome, preco, disponivel, ordem) values",
  grupos
    .flatMap((g) => g.opcoes)
    .map((o) => `  (${q(o.id)}, ${q(o.grupo_id)}, ${q(o.nome)}, ${o.preco}, ${q(o.disponivel)}, ${o.ordem})`)
    .join(",\n"),
  "on conflict (id) do update set nome = excluded.nome, preco = excluded.preco, disponivel = excluded.disponivel, ordem = excluded.ordem;",
  "",
  "insert into public.regioes_entrega (id, nome, taxa, ordem, ativa) values",
  REGIOES_EXEMPLO.map((x) => `  (${q(x.id)}, ${q(x.nome)}, ${x.taxa}, ${x.ordem}, ${q(x.ativa)})`).join(",\n"),
  "on conflict (id) do update set nome = excluded.nome, taxa = excluded.taxa, ordem = excluded.ordem, ativa = excluded.ativa;",
  "",
];

const destino = resolve(__dirname, "../supabase/seed.sql");
writeFileSync(destino, linhas.join("\n"));
console.log(`✔ ${destino} gerado`);
