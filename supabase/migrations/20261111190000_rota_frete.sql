-- Mapa do trajeto no cálculo do frete: a cotação guarda o trajeto de carro
-- (polilinha codificada do Google), o ponto do cliente e o tempo estimado.
-- A função mapa-frete usa isso para desenhar o mapa sem expor a chave do Google.
alter table public.cotacoes_frete
  add column if not exists rota text,
  add column if not exists destino_lat double precision,
  add column if not exists destino_lng double precision,
  add column if not exists minutos integer check (minutos is null or minutos >= 0);
