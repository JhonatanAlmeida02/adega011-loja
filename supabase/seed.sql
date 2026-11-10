-- Gerado por scripts/gerar-seed-sql.ts — não edite à mão.
-- Dados de exemplo: 4 categorias, 10 produtos, 3 regiões e configuração da loja.
-- Pode rodar mais de uma vez (faz upsert).

insert into public.configuracoes (id, nome, slogan, whatsapp, endereco, instagram, horarios, status_manual, pedido_minimo, aceita_entrega, aceita_retirada, pagamentos, chave_pix, tempo_entrega, banner_titulo, banner_texto, banner_botao_texto, banner_botao_link, banner_imagem_url)
values (1, 'Adega011', 'São Paulo no copo', '5511941522867', 'Travessa Sebastião I de Camargo, 72 · Jardim Galetto, Itatiba - SP', '_adega.011', '{"0":[{"abre":"14:00","fecha":"22:00"}],"1":[{"abre":"16:00","fecha":"00:00"}],"2":[{"abre":"16:00","fecha":"00:00"}],"3":[{"abre":"16:00","fecha":"00:00"}],"4":[{"abre":"16:00","fecha":"00:00"}],"5":[{"abre":"16:00","fecha":"02:00"}],"6":[{"abre":"16:00","fecha":"02:00"}]}'::jsonb, 'auto', 3000, true, true, array['pix', 'cartao', 'dinheiro'], '', '30–50 min', 'São Paulo no copo', 'Vinho, destilado, cerveja gelada e combo pronto pro rolê. Pede aqui, chega aí.', 'Ver combos', '#combos', null)
on conflict (id) do update set nome = excluded.nome, slogan = excluded.slogan, whatsapp = excluded.whatsapp, endereco = excluded.endereco, instagram = excluded.instagram, horarios = excluded.horarios, status_manual = excluded.status_manual, pedido_minimo = excluded.pedido_minimo, aceita_entrega = excluded.aceita_entrega, aceita_retirada = excluded.aceita_retirada, pagamentos = excluded.pagamentos, chave_pix = excluded.chave_pix, tempo_entrega = excluded.tempo_entrega, banner_titulo = excluded.banner_titulo, banner_texto = excluded.banner_texto, banner_botao_texto = excluded.banner_botao_texto, banner_botao_link = excluded.banner_botao_link, banner_imagem_url = excluded.banner_imagem_url;

insert into public.categorias (id, nome, slug, ordem, ativa) values
  ('c0000000-0000-4000-8000-000000000001', 'Combos', 'combos', 0, true),
  ('c0000000-0000-4000-8000-000000000002', 'Vinhos', 'vinhos', 1, true),
  ('c0000000-0000-4000-8000-000000000003', 'Destilados', 'destilados', 2, true),
  ('c0000000-0000-4000-8000-000000000004', 'Cervejas', 'cervejas', 3, true)
on conflict (id) do update set nome = excluded.nome, slug = excluded.slug, ordem = excluded.ordem, ativa = excluded.ativa;

insert into public.produtos (id, categoria_id, nome, descricao, preco, foto_url, destaque, disponivel, ativo, ordem) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Combo Gin Tônica', 'Gin London Dry 750 ml + 4 tônicas 350 ml + gelo 2 kg. É só montar o copo.', 14990, '/produtos/combo-gin.svg', true, true, true, 1),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Combo Vodka + Energético', 'Vodka 1 L + 4 energéticos 473 ml + gelo 2 kg. Pra virar a noite.', 12990, '/produtos/combo-vodka.svg', false, true, true, 2),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'Tinto Malbec 750 ml', 'Argentino, encorpado, com notas de ameixa e baunilha. Vai bem com carne e papo longo.', 6990, '/produtos/vinho-tinto.svg', true, true, true, 3),
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 'Branco Sauvignon Blanc 750 ml', 'Chileno, fresco e cítrico. Gelado é outra coisa.', 5490, '/produtos/vinho-branco.svg', false, true, true, 4),
  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 'Espumante Brut Rosé 750 ml', 'Serra Gaúcha, borbulha fina e fruta vermelha. Pra brindar qualquer coisa.', 7990, '/produtos/espumante.svg', false, false, true, 5),
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003', 'Gin London Dry 750 ml', 'Seco, cítrico e com zimbro marcado. Base perfeita pro seu drink.', 11990, '/produtos/gin.svg', true, true, true, 6),
  ('a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003', 'Vodka Premium 1 L', 'Destilada cinco vezes, lisa e neutra. Combina com tudo.', 8990, '/produtos/vodka.svg', false, true, true, 7),
  ('a0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000003', 'Whisky 12 anos 1 L', 'Blended escocês, notas de mel, malte e um defumado leve.', 18990, '/produtos/whisky.svg', false, true, true, 8),
  ('a0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000004', 'IPA 473 ml', 'Lata de IPA artesanal paulistana: amarga na medida, aroma de maracujá.', 1490, '/produtos/cerveja-lata.svg', false, true, true, 9),
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000004', 'Pilsen 350 ml · pack 12', 'Doze latas de pilsen trincando. O clássico que não falha.', 5490, '/produtos/cerveja-pack.svg', true, true, true, 10)
on conflict (id) do update set categoria_id = excluded.categoria_id, nome = excluded.nome, descricao = excluded.descricao, preco = excluded.preco, foto_url = excluded.foto_url, destaque = excluded.destaque, disponivel = excluded.disponivel, ativo = excluded.ativo, ordem = excluded.ordem;

insert into public.regioes_entrega (id, nome, taxa, ordem, ativa) values
  ('e0000000-0000-4000-8000-000000000001', 'Região A · até 3 km', 500, 0, true),
  ('e0000000-0000-4000-8000-000000000002', 'Região B · 3 a 6 km', 800, 1, true),
  ('e0000000-0000-4000-8000-000000000003', 'Região C · 6 a 10 km', 1200, 2, true)
on conflict (id) do update set nome = excluded.nome, taxa = excluded.taxa, ordem = excluded.ordem, ativa = excluded.ativa;
