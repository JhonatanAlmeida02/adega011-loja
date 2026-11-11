-- A Edge Function cotar-frete usa a chave de serviço (secret key).
-- Em projetos novos do Supabase as tabelas não recebem permissões automáticas
-- para o papel service_role, então liberamos só o que a função precisa.

grant usage on schema public to service_role;

-- ler os parâmetros do frete e guardar a posição da loja já geocodificada
grant select on public.configuracoes to service_role;
grant update (loja_lat, loja_lng, loja_endereco_geocodificado) on public.configuracoes to service_role;

-- limitar tentativas por IP e gravar a cotação
grant select, insert on public.cotacoes_frete to service_role;
